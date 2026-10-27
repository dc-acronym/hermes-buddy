//! Small JSON blobs in the app config dir (`<name>.json`) plus the Rust-owned `config.json`.
//!
//! Everything here takes explicit paths (no `AppHandle`) so it can be unit-tested with a temp dir.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `config.json` belongs to the Rust side (Hermes db path override). The UI may not use this name.
pub const CONFIG_NAME: &str = "config";

/// `^[a-z0-9_-]{1,32}$`
pub fn valid_name(name: &str) -> bool {
    (1..=32).contains(&name.len())
        && name
            .bytes()
            .all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
}

fn ui_json_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!(
            "invalid json name {name:?}: expected [a-z0-9_-]{{1,32}}"
        ));
    }
    if name == CONFIG_NAME {
        return Err(format!("json name {name:?} is reserved"));
    }
    Ok(dir.join(format!("{name}.json")))
}

/// Write `bytes` to `path` atomically and durably: into a sibling temp file, fsynced, then renamed
/// over the target (and the directory fsynced, best effort). A crash leaves either the old or the
/// new file, never a torn one; the temp file is removed if anything fails.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomic_with(path, bytes, |f| f.sync_all())
}

/// [`write_atomic`] with the fsync step injectable (for tests).
fn write_atomic_with(
    path: &Path,
    bytes: &[u8],
    sync: impl FnOnce(&fs::File) -> io::Result<()>,
) -> io::Result<()> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty());
    if let Some(parent) = parent {
        fs::create_dir_all(parent)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let written = (|| -> io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        sync(&file)?;
        drop(file); // closed before the rename (Windows will not rename an open file)
        fs::rename(&tmp, path)
    })();
    match written {
        Ok(()) => {
            sync_dir(parent.unwrap_or(Path::new(".")));
            Ok(())
        }
        Err(e) => {
            // Only a plain file is ours to remove (the failure may be that something else sits here).
            if fs::symlink_metadata(&tmp).is_ok_and(|m| m.is_file()) {
                let _ = fs::remove_file(&tmp);
            }
            Err(e)
        }
    }
}

/// Make the rename itself durable: fsync the directory. Unix only; elsewhere (and on any error)
/// it is a no-op, since the file contents are already safe.
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// Missing file -> `None`. A corrupt file also reads as `None` (the UI falls back to defaults)
/// and is logged rather than turned into an error the UI would have to handle at startup.
pub fn load_json(dir: &Path, name: &str) -> Result<Option<Value>, String> {
    let path = ui_json_path(dir, name)?;
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("read {}: {e}", path.display())),
    };
    match serde_json::from_slice(&bytes) {
        Ok(v) => Ok(Some(v)),
        Err(e) => {
            eprintln!("[hermes-buddy] ignoring corrupt {}: {e}", path.display());
            Ok(None)
        }
    }
}

pub fn save_json(dir: &Path, name: &str, value: &Value) -> Result<(), String> {
    let path = ui_json_path(dir, name)?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    write_atomic(&path, &bytes).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Delete every `<valid-name>.json` (and stale `.tmp`) in `dir`, including `config.json`.
/// Anything else in the directory is left alone. A file that cannot be removed does not stop the
/// rest from being removed; the first such error is returned at the end.
pub fn clear_json(dir: &Path) -> io::Result<()> {
    clear_json_with(dir, |p| fs::remove_file(p))
}

/// [`clear_json`] with the removal step injectable (for tests).
fn clear_json_with(dir: &Path, mut remove: impl FnMut(&Path) -> io::Result<()>) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let mut first_error = None;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                first_error.get_or_insert(e);
                continue;
            }
        };
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let stem = file_name
            .strip_suffix(".json")
            .or_else(|| file_name.strip_suffix(".json.tmp"));
        if stem.is_some_and(valid_name) && entry.file_type().is_ok_and(|t| t.is_file()) {
            if let Err(e) = remove(&entry.path()) {
                first_error.get_or_insert(e);
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Persisted Rust-side settings (`config.json`).
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// User override for the Hermes `state.db` path, exactly as typed. `None` = default location.
    pub db_path: Option<String>,
}

fn config_path(dir: &Path) -> PathBuf {
    dir.join(format!("{CONFIG_NAME}.json"))
}

pub fn read_config(dir: &Path) -> AppConfig {
    fs::read(config_path(dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn write_config(dir: &Path, cfg: &AppConfig) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;
    write_atomic(&config_path(dir), &bytes).map_err(|e| format!("write config.json: {e}"))
}

/// Normalise what the user typed in the db-path overlay: trim, blank -> `None`.
pub fn normalize_db_path(path: Option<String>) -> Option<String> {
    path.map(|p| p.trim().to_owned()).filter(|p| !p.is_empty())
}

/// `~` and `~/x` -> home dir. Everything else is passed through untouched.
pub fn expand_tilde(path: &str) -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        if path == "~" {
            return home;
        }
        if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn names_follow_the_contract() {
        for ok in ["a", "stats", "pet_1", "a-b", "0", &"x".repeat(32)] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in [
            "",
            "Stats",
            "a b",
            "a.b",
            "../x",
            "a/b",
            "a\\b",
            "é",
            "x\n",
            &"x".repeat(33),
        ] {
            assert!(!valid_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn json_roundtrip_and_validation() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_json(dir.path(), "stats").unwrap(), None);
        let v = json!({"mood": 3, "nested": [1, 2, {"a": null}]});
        save_json(dir.path(), "stats", &v).unwrap();
        assert_eq!(load_json(dir.path(), "stats").unwrap(), Some(v));
        // overwrite
        save_json(dir.path(), "stats", &json!(7)).unwrap();
        assert_eq!(load_json(dir.path(), "stats").unwrap(), Some(json!(7)));

        for bad in ["", "../etc/passwd", "Stats", "a.json", "config"] {
            assert!(save_json(dir.path(), bad, &json!(1)).is_err(), "{bad}");
            assert!(load_json(dir.path(), bad).is_err(), "{bad}");
        }
        // nothing escaped or got created by the rejected calls
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("stats.json")]);
    }

    #[test]
    fn corrupt_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), b"{not json").unwrap();
        assert_eq!(load_json(dir.path(), "settings").unwrap(), None);
    }

    #[test]
    fn config_roundtrip_is_camel_case() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_config(dir.path()), AppConfig::default());
        let cfg = AppConfig {
            db_path: Some("/tmp/x/state.db".into()),
        };
        write_config(dir.path(), &cfg).unwrap();
        let raw: Value =
            serde_json::from_slice(&fs::read(dir.path().join("config.json")).unwrap()).unwrap();
        assert_eq!(raw, json!({"dbPath": "/tmp/x/state.db"}));
        assert_eq!(read_config(dir.path()), cfg);
        fs::write(dir.path().join("config.json"), b"garbage").unwrap();
        assert_eq!(read_config(dir.path()), AppConfig::default());
    }

    #[test]
    fn clear_json_only_removes_managed_files() {
        let dir = tempfile::tempdir().unwrap();
        save_json(dir.path(), "stats", &json!(1)).unwrap();
        save_json(dir.path(), "settings", &json!(2)).unwrap();
        write_config(
            dir.path(),
            &AppConfig {
                db_path: Some("x".into()),
            },
        )
        .unwrap();
        fs::write(dir.path().join("stats.json.tmp"), b"x").unwrap();
        fs::write(dir.path().join("notes.txt"), b"keep").unwrap();
        fs::write(dir.path().join("Weird Name.json"), b"keep").unwrap();
        fs::create_dir(dir.path().join("sub.json")).unwrap();
        clear_json(dir.path()).unwrap();
        let mut left: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, vec!["Weird Name.json", "notes.txt", "sub.json"]);
        // missing dir is fine
        clear_json(&dir.path().join("nope")).unwrap();
    }

    #[test]
    fn db_path_normalising() {
        assert_eq!(normalize_db_path(None), None);
        assert_eq!(normalize_db_path(Some("  ".into())), None);
        assert_eq!(
            normalize_db_path(Some(" /a/b ".into())),
            Some("/a/b".into())
        );
    }

    #[test]
    fn tilde_expansion() {
        let home = dirs::home_dir().expect("home dir in test env");
        assert_eq!(expand_tilde("~"), home);
        assert_eq!(expand_tilde("~/x/state.db"), home.join("x/state.db"));
        assert_eq!(
            expand_tilde("/abs/state.db"),
            PathBuf::from("/abs/state.db")
        );
        assert_eq!(expand_tilde("~other/x"), PathBuf::from("~other/x"));
    }

    #[test]
    fn the_temp_file_is_synced_before_it_replaces_the_target() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.json");
        write_atomic(&path, b"old").unwrap();
        let tmp = dir.path().join("stats.json.tmp");

        let mut synced = false;
        write_atomic_with(&path, b"new contents", |f| {
            // At sync time the data is fully in the temp file and the target is still intact:
            // the rename that follows can only ever publish complete, durable bytes.
            assert_eq!(fs::read(&tmp).unwrap(), b"new contents");
            assert_eq!(fs::read(&path).unwrap(), b"old");
            f.sync_all()?;
            synced = true;
            Ok(())
        })
        .unwrap();
        assert!(synced);
        assert_eq!(fs::read(&path).unwrap(), b"new contents");
        assert!(!tmp.exists());
    }

    #[test]
    fn a_failure_at_any_step_leaves_no_temp_file_and_the_old_target() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stats.json");
        let tmp = dir.path().join("stats.json.tmp");
        write_atomic(&path, b"old").unwrap();

        // sync fails
        let err = write_atomic_with(&path, b"new", |_| Err(io::Error::other("disk on fire")))
            .unwrap_err();
        assert_eq!(err.to_string(), "disk on fire");
        assert!(!tmp.exists(), "temp file left behind after a sync failure");
        assert_eq!(fs::read(&path).unwrap(), b"old");

        // rename fails (the target is a directory)
        let blocked = dir.path().join("blocked.json");
        fs::create_dir(&blocked).unwrap();
        assert!(write_atomic(&blocked, b"x").is_err());
        assert!(!dir.path().join("blocked.json.tmp").exists());

        // writing the temp file fails (a directory sits where it would go)
        let odd = dir.path().join("odd.json");
        fs::create_dir(dir.path().join("odd.json.tmp")).unwrap();
        assert!(write_atomic(&odd, b"x").is_err());
        assert!(
            dir.path().join("odd.json.tmp").is_dir(),
            "someone else's directory is not ours to remove"
        );
    }

    #[test]
    fn clear_json_keeps_going_past_a_failure_and_reports_it() {
        let dir = tempfile::tempdir().unwrap();
        for n in ["a", "b", "c", "d"] {
            save_json(dir.path(), n, &json!(1)).unwrap();
        }
        fs::write(dir.path().join("b.json.tmp"), b"x").unwrap();
        let mut attempted = Vec::new();
        let err = clear_json_with(dir.path(), |p| {
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            attempted.push(name.clone());
            if name == "b.json" || name == "c.json" {
                return Err(io::Error::other(format!("cannot remove {name}")));
            }
            fs::remove_file(p)
        })
        .unwrap_err();
        // Every managed file was attempted, and the ones that could go, went.
        attempted.sort();
        assert_eq!(
            attempted,
            vec!["a.json", "b.json", "b.json.tmp", "c.json", "d.json"]
        );
        let mut left: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, vec!["b.json", "c.json"]);
        // The first failure is the one reported.
        assert!(err.to_string().starts_with("cannot remove "), "{err}");
    }
}
