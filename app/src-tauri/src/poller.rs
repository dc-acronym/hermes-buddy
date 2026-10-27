//! Background poller: one thread owns the `hermes_watch::Watcher`, polls every 10 s and
//! immediately when woken (`poll_now`, `set_db_path`), and emits `hermes://snapshot`.
//!
//! The wake/coalesce logic is generic over a [`Source`] so it can be unit-tested with a fake
//! source and tiny intervals; [`spawn`] plugs in the real watcher.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use hermes_watch::Watcher;
use tauri::{AppHandle, Emitter};

pub const SNAPSHOT_EVENT: &str = "hermes://snapshot";
pub const INTERVAL: Duration = Duration::from_secs(10);
/// The first re-poll comes early: the webview is usually still loading (and not yet
/// listening) when the very first snapshot is emitted at startup.
pub const WARMUP: Duration = Duration::from_secs(2);

#[derive(Debug)]
enum Msg {
    PollNow,
    SetPath(Option<PathBuf>),
}

/// Cheap cloneable handle held in Tauri state.
#[derive(Debug, Clone)]
pub struct PollerHandle(Sender<Msg>);

impl PollerHandle {
    /// Wake the poller; a snapshot is emitted right away.
    pub fn poll_now(&self) {
        let _ = self.0.send(Msg::PollNow);
    }

    /// Point the watcher at a different db (`None` = default location) and poll immediately.
    pub fn set_path(&self, path: Option<PathBuf>) {
        let _ = self.0.send(Msg::SetPath(path));
    }
}

/// Anything that can produce snapshots; the real one wraps `hermes_watch::Watcher`.
trait Source {
    type Snap;
    /// `None` = nothing to emit this round (the source failed internally).
    fn poll(&mut self) -> Option<Self::Snap>;
    fn set_path(&mut self, path: Option<PathBuf>);
}

/// Poll, emit, then sleep until `interval` elapses or a message arrives. Returns when every
/// [`PollerHandle`] is gone.
fn run_loop<S: Source>(
    rx: Receiver<Msg>,
    mut source: S,
    first_wait: Duration,
    interval: Duration,
    mut emit: impl FnMut(S::Snap),
) {
    let mut wait = first_wait;
    loop {
        if let Some(snap) = source.poll() {
            emit(snap);
        }

        let deadline = Instant::now() + wait;
        wait = interval;
        match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(msg) => apply(&mut source, msg),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // Coalesce a burst of requests into the one poll we are about to do.
        while let Ok(msg) = rx.try_recv() {
            apply(&mut source, msg);
        }
    }
}

fn apply<S: Source>(source: &mut S, msg: Msg) {
    if let Msg::SetPath(path) = msg {
        source.set_path(path);
    }
}

/// The real source. A panic inside the watcher must never take the poller down: the watcher
/// is rebuilt and that round is skipped.
struct WatchSource {
    watcher: Watcher,
    path: Option<PathBuf>,
}

impl Source for WatchSource {
    type Snap = hermes_watch::HermesSnapshot;

    fn poll(&mut self) -> Option<Self::Snap> {
        match catch_unwind(AssertUnwindSafe(|| self.watcher.poll())) {
            Ok(snap) => Some(snap),
            Err(_) => {
                eprintln!("[hermes-buddy] watcher panicked; restarting it");
                self.watcher = Watcher::new(self.path.clone());
                None
            }
        }
    }

    fn set_path(&mut self, path: Option<PathBuf>) {
        self.watcher.set_path(path.clone());
        self.path = path;
    }
}

/// Start the poller thread. `initial` is the persisted db-path override, if any.
pub fn spawn(app: AppHandle, initial: Option<PathBuf>) -> PollerHandle {
    let (tx, rx) = mpsc::channel();
    let debug = std::env::var_os("HERMES_BUDDY_DEBUG").is_some();
    let spawned = std::thread::Builder::new()
        .name("hermes-poller".into())
        .spawn(move || {
            let source = WatchSource {
                watcher: Watcher::new(initial.clone()),
                path: initial,
            };
            run_loop(rx, source, WARMUP, INTERVAL, |snap| {
                if debug {
                    match serde_json::to_string(&snap) {
                        Ok(json) => eprintln!("[hermes-buddy] emit {SNAPSHOT_EVENT}: {json}"),
                        Err(e) => eprintln!("[hermes-buddy] snapshot did not serialize: {e}"),
                    }
                }
                if let Err(e) = app.emit(SNAPSHOT_EVENT, &snap) {
                    eprintln!("[hermes-buddy] emit {SNAPSHOT_EVENT} failed: {e}");
                }
            });
        });
    if let Err(e) = spawned {
        eprintln!("[hermes-buddy] could not start the poller thread: {e}");
    }
    PollerHandle(tx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Default, Clone)]
    struct Log(Arc<Mutex<Vec<String>>>);

    impl Log {
        fn push(&self, s: impl Into<String>) {
            self.0.lock().unwrap().push(s.into());
        }
        fn snapshot(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }
    }

    struct Fake {
        n: u32,
        path: Option<PathBuf>,
        log: Log,
        fail_every: Option<u32>,
    }

    impl Source for Fake {
        type Snap = (u32, Option<PathBuf>);
        fn poll(&mut self) -> Option<Self::Snap> {
            self.n += 1;
            self.log.push(format!("poll{}", self.n));
            if self.fail_every.is_some_and(|k| self.n.is_multiple_of(k)) {
                return None;
            }
            Some((self.n, self.path.clone()))
        }
        fn set_path(&mut self, path: Option<PathBuf>) {
            self.log.push(format!("set{:?}", path));
            self.path = path;
        }
    }

    type Started = (
        Sender<Msg>,
        Receiver<(u32, Option<PathBuf>)>,
        std::thread::JoinHandle<()>,
        Log,
    );

    fn start(first: Duration, interval: Duration, fail_every: Option<u32>) -> Started {
        let (tx, rx) = mpsc::channel();
        let (out_tx, out_rx) = mpsc::channel();
        let log = Log::default();
        let fake = Fake {
            n: 0,
            path: None,
            log: log.clone(),
            fail_every,
        };
        let handle = std::thread::spawn(move || {
            run_loop(rx, fake, first, interval, |s| {
                let _ = out_tx.send(s);
            })
        });
        (tx, out_rx, handle, log)
    }

    const LONG: Duration = Duration::from_secs(60);
    const TIMEOUT: Duration = Duration::from_secs(5);

    #[test]
    fn polls_at_startup_then_on_interval() {
        let (tx, out, handle, _) =
            start(Duration::from_millis(30), Duration::from_millis(30), None);
        let t0 = Instant::now();
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap().0, 1);
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap().0, 2);
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap().0, 3);
        assert!(t0.elapsed() >= Duration::from_millis(55));
        drop(tx);
        handle.join().unwrap();
    }

    #[test]
    fn poll_now_wakes_immediately() {
        let (tx, out, handle, _) = start(LONG, LONG, None);
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap().0, 1);
        let t0 = Instant::now();
        tx.send(Msg::PollNow).unwrap();
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap().0, 2);
        assert!(t0.elapsed() < Duration::from_secs(2));
        drop(tx);
        handle.join().unwrap();
    }

    #[test]
    fn set_path_is_applied_before_the_next_poll() {
        let (tx, out, handle, log) = start(LONG, LONG, None);
        out.recv_timeout(TIMEOUT).unwrap();
        tx.send(Msg::SetPath(Some(PathBuf::from("/x/state.db"))))
            .unwrap();
        let (n, path) = out.recv_timeout(TIMEOUT).unwrap();
        assert_eq!((n, path), (2, Some(PathBuf::from("/x/state.db"))));
        tx.send(Msg::SetPath(None)).unwrap();
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap(), (3, None));
        drop(tx);
        handle.join().unwrap();
        assert_eq!(
            log.snapshot(),
            vec![
                "poll1",
                "setSome(\"/x/state.db\")",
                "poll2",
                "setNone",
                "poll3"
            ]
        );
    }

    #[test]
    fn bursts_are_coalesced_into_one_poll() {
        // Everything is queued before the thread starts: poll 1 happens, then the loop wakes on
        // the first message, drains the rest, and does exactly one more poll that already saw
        // the last path.
        let (tx, rx) = mpsc::channel();
        for p in ["/a", "/b", "/c"] {
            tx.send(Msg::SetPath(Some(PathBuf::from(p)))).unwrap();
            tx.send(Msg::PollNow).unwrap();
        }
        let (out_tx, out) = mpsc::channel();
        let log = Log::default();
        let fake = Fake {
            n: 0,
            path: None,
            log: log.clone(),
            fail_every: None,
        };
        let handle = std::thread::spawn(move || {
            run_loop(rx, fake, LONG, LONG, |s| {
                let _ = out_tx.send(s);
            })
        });
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap(), (1, None));
        assert_eq!(
            out.recv_timeout(TIMEOUT).unwrap(),
            (2, Some(PathBuf::from("/c")))
        );
        assert!(
            out.recv_timeout(Duration::from_millis(200)).is_err(),
            "no third poll"
        );
        drop(tx);
        handle.join().unwrap();
        assert_eq!(
            log.snapshot(),
            vec![
                "poll1",
                "setSome(\"/a\")",
                "setSome(\"/b\")",
                "setSome(\"/c\")",
                "poll2"
            ]
        );
    }

    #[test]
    fn a_failed_poll_emits_nothing_but_the_loop_survives() {
        let (tx, out, handle, log) = start(LONG, LONG, Some(2));
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap().0, 1);
        tx.send(Msg::PollNow).unwrap(); // poll 2 fails -> nothing emitted
        let deadline = Instant::now() + TIMEOUT;
        while !log.snapshot().contains(&"poll2".to_string()) {
            assert!(Instant::now() < deadline, "poll 2 never happened");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(out.recv_timeout(Duration::from_millis(100)).is_err());
        tx.send(Msg::PollNow).unwrap(); // poll 3 ok
        assert_eq!(out.recv_timeout(TIMEOUT).unwrap().0, 3);
        drop(tx);
        handle.join().unwrap();
    }

    #[test]
    fn exits_when_the_last_handle_is_dropped() {
        let (tx, _out, handle, _) = start(LONG, LONG, None);
        drop(tx);
        handle.join().unwrap();
    }
}
