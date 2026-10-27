//! Print one `HermesSnapshot` as pretty JSON.
//!
//! ```text
//! cargo run -p hermes-watch --example snapshot -- [db path] [--watch]
//! ```
//!
//! With no path it uses `$HERMES_HOME/state.db`, else the platform default. `--watch` keeps
//! polling every 10 s (one compact JSON line per poll), like the app does.

use std::path::PathBuf;
use std::time::Duration;

use hermes_watch::Watcher;

fn main() {
    let mut watch = false;
    let mut path: Option<PathBuf> = None;
    for arg in std::env::args().skip(1) {
        match arg.as_str() {
            "--watch" | "-w" => watch = true,
            "--help" | "-h" => {
                eprintln!("usage: snapshot [db path] [--watch]");
                return;
            }
            _ => path = Some(PathBuf::from(arg)),
        }
    }

    let mut watcher = Watcher::new(path);
    eprintln!("watching {}", watcher.resolved_path().display());
    loop {
        let snapshot = watcher.poll();
        let json = if watch {
            serde_json::to_string(&snapshot)
        } else {
            serde_json::to_string_pretty(&snapshot)
        };
        println!("{}", json.expect("snapshot serialises"));
        if !watch {
            break;
        }
        std::thread::sleep(Duration::from_secs(10));
    }
}
