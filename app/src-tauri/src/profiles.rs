//! Hermes profiles: the default home plus each named profile under `<home>/profiles/<name>/`,
//! every one with its own `state.db` (same schema), e.g.
//!   ~/.hermes/state.db                       default
//!   ~/.hermes/profiles/test-profile/state.db  "test-profile"

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Profile {
    /// "default" for the home profile, else the profile's directory name.
    pub name: String,
    pub path: String,
}

pub const DEFAULT_PROFILE: &str = "default";

/// The default profile first, then every named profile that has a `state.db`, sorted by name.
/// Profiles without a database yet are skipped: there is nothing to watch.
pub fn list(default_db: &Path) -> Vec<Profile> {
    let mut out = vec![Profile {
        name: DEFAULT_PROFILE.to_string(),
        path: default_db.to_string_lossy().into_owned(),
    }];
    let Some(home) = default_db.parent() else {
        return out;
    };
    let mut named: Vec<(String, PathBuf)> = std::fs::read_dir(home.join("profiles"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let db = entry.path().join("state.db");
            db.is_file().then_some((name, db))
        })
        .collect();
    named.sort_by(|a, b| a.0.cmp(&b.0));
    out.extend(named.into_iter().map(|(name, db)| Profile {
        name,
        path: db.to_string_lossy().into_owned(),
    }));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn default_first_then_named_profiles_with_a_db_sorted() {
        let home = tempfile::tempdir().unwrap();
        let default_db = home.path().join("state.db");
        for (name, has_db) in [("zed", true), ("bob", true), ("empty", false)] {
            let dir = home.path().join("profiles").join(name);
            fs::create_dir_all(&dir).unwrap();
            if has_db {
                fs::write(dir.join("state.db"), b"").unwrap();
            }
        }
        fs::write(home.path().join("profiles").join("stray-file"), b"").unwrap();

        let names: Vec<_> = list(&default_db).into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["default", "bob", "zed"]);
        let bob = &list(&default_db)[1];
        assert_eq!(
            Path::new(&bob.path),
            home.path().join("profiles/bob/state.db")
        );
    }

    #[test]
    fn no_profiles_dir_is_just_default() {
        let home = tempfile::tempdir().unwrap();
        let default_db = home.path().join("state.db");
        assert_eq!(
            list(&default_db),
            vec![Profile {
                name: "default".into(),
                path: default_db.to_string_lossy().into_owned()
            }]
        );
    }
}
