//! GIF character packs: a folder with `manifest.json` + `*.gif`, dropped on the window.
//!
//! Only `manifest.json` and top-level `*.gif` files are copied (nothing else from the dropped
//! folder ever lands in app data), at most [`MAX_PACK_BYTES`] in total and [`MAX_FILES`] GIFs.
//! A pack is validated completely before anything is installed: the manifest must be a regular
//! file (not a link to somewhere else), every file its `states` name must be in the pack, and
//! every `.gif` must really start like a GIF. The installed pack is replaced by renaming, never
//! by deleting first, so a failure leaves the previous pack in place. All functions take
//! explicit paths so they can be tested with a temp dir.
//!
//! Errors are short, human-readable reasons: the shell shows them as a toast
//! (`buddy://character-error`).

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_PACK_BYTES: u64 = 4 * 1024 * 1024;
/// Most GIFs in a pack (the UI plays at most 32 of them; the rest is headroom for spares).
pub const MAX_FILES: usize = 64;
const MANIFEST: &str = "manifest.json";
const MAX_NAME_CHARS: usize = 64;

/// Wire shape shared with the UI (`CharacterPack` in `src/data/types.ts`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CharacterPack {
    pub name: String,
    pub manifest: Value,
    /// filename -> base64 bytes
    pub files: BTreeMap<String, String>,
}

/// The first dropped path that is a directory containing `manifest.json`.
pub fn pick_pack_dir(paths: &[PathBuf]) -> Option<&Path> {
    paths
        .iter()
        .map(PathBuf::as_path)
        .find(|p| p.is_dir() && p.join(MANIFEST).is_file())
}

fn is_gif_name(name: &str) -> bool {
    !name.starts_with('.') // skips macOS "._foo.gif" AppleDouble files
        && Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("gif"))
}

fn is_gif_data(bytes: &[u8]) -> bool {
    bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
}

/// Read `path` fully, but never more than `limit` bytes (a file that grew since it was sized
/// reads as `limit`, which the caller then rejects).
fn read_capped(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)?.take(limit).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Every file name a manifest's `states` point at: a string, or the strings of an array.
/// (Anything else, such as the `{frames, delay}` objects of text packs, names no file.)
fn referenced_files(manifest: &Value) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    let Some(states) = manifest.get("states").and_then(Value::as_object) else {
        return out;
    };
    for (state, value) in states {
        match value {
            Value::String(f) => out.push((state.as_str(), f.as_str())),
            Value::Array(list) => out.extend(
                list.iter()
                    .filter_map(Value::as_str)
                    .map(|f| (state.as_str(), f)),
            ),
            _ => {}
        }
    }
    out
}

/// Validate and copy the pack in `src` into `dest` (replacing any existing pack there),
/// returning it as the UI wants it. `dest` is only touched once everything has validated.
pub fn install(src: &Path, dest: &Path) -> Result<CharacterPack, String> {
    if !src.is_dir() {
        return Err("not a folder".into());
    }

    // The manifest must be a regular file in the folder: a link could point anywhere on disk.
    let manifest_path = src.join(MANIFEST);
    let md = fs::symlink_metadata(&manifest_path).map_err(|_| format!("no {MANIFEST}"))?;
    if md.file_type().is_symlink() {
        return Err(format!("{MANIFEST} is a link, not a file"));
    }
    if !md.is_file() {
        return Err(format!("no {MANIFEST}"));
    }
    let mut total = md.len();
    if total > MAX_PACK_BYTES {
        return Err(too_big());
    }
    let manifest_bytes = read_capped(&manifest_path, MAX_PACK_BYTES)
        .map_err(|e| format!("can't read {MANIFEST}: {e}"))?;
    let mut manifest: Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| format!("{MANIFEST} is not valid JSON"))?;
    if !manifest.get("states").is_some_and(Value::is_object) {
        return Err(format!("{MANIFEST} has no \"states\" object"));
    }

    // Collect the gifs (flat; symlinks and subfolders are ignored), enforcing the count and size
    // caps from metadata before reading anything.
    let mut gifs: Vec<(String, PathBuf)> = Vec::new();
    for entry in fs::read_dir(src)
        .map_err(|e| format!("can't read the folder: {e}"))?
        .flatten()
    {
        let Ok(file_name) = entry.file_name().into_string() else {
            continue;
        };
        if !is_gif_name(&file_name) || !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        if gifs.len() == MAX_FILES {
            return Err(format!("too many GIFs (max {MAX_FILES})"));
        }
        let len = entry
            .metadata()
            .map_err(|e| format!("can't read {file_name}: {e}"))?
            .len();
        total += len;
        if total > MAX_PACK_BYTES {
            return Err(too_big());
        }
        gifs.push((file_name, entry.path()));
    }
    if gifs.is_empty() {
        return Err("pack has no .gif files".into());
    }
    gifs.sort();

    // Everything a state points at has to be one of those gifs, by its exact name.
    for (state, file) in referenced_files(&manifest) {
        if gifs
            .binary_search_by(|(name, _)| name.as_str().cmp(file))
            .is_err()
        {
            return Err(format!("{state}: {file} is not in the pack"));
        }
    }

    let name = pack_name(&manifest, src);
    // Remember the folder name for packs without one, so get_character can return it later.
    if let Some(obj) = manifest.as_object_mut() {
        if obj
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            obj.insert("name".into(), Value::String(name.clone()));
        }
    }

    let mut files = BTreeMap::new();
    let mut blobs = Vec::with_capacity(gifs.len());
    let mut read_total = 0u64;
    for (file_name, path) in gifs {
        let bytes = read_capped(&path, MAX_PACK_BYTES + 1)
            .map_err(|e| format!("can't read {file_name}: {e}"))?;
        read_total += bytes.len() as u64;
        if read_total > MAX_PACK_BYTES {
            return Err(too_big());
        }
        if !is_gif_data(&bytes) {
            return Err(format!("{file_name} is not a GIF"));
        }
        files.insert(file_name.clone(), STANDARD.encode(&bytes));
        blobs.push((file_name, bytes));
    }

    // Stage next to `dest`, then swap in.
    let parent = dest.parent().ok_or("character dir has no parent")?;
    fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    recover(dest);
    let staging = sibling(dest, "staging");
    remove_dir_if_exists(&staging).map_err(|e| format!("clear staging: {e}"))?;
    let staged = (|| -> io::Result<()> {
        fs::create_dir(&staging)?;
        for (file_name, bytes) in &blobs {
            fs::write(staging.join(file_name), bytes)?;
        }
        fs::write(
            staging.join(MANIFEST),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        swap_in(&staging, dest)
    })();
    if let Err(e) = staged {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("install character: {e}"));
    }

    Ok(CharacterPack {
        name,
        manifest,
        files,
    })
}

/// `<dest>` with a hidden sibling name: `.character.staging`, `.character.old`.
fn sibling(dest: &Path, what: &str) -> PathBuf {
    let name = dest
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    dest.with_file_name(format!(".{name}.{what}"))
}

/// Put the finished `staging` directory in place of `dest`: `dest` is renamed aside to
/// `.<dest>.old`, `staging` renamed to `dest`, and only then is the old pack deleted. If the
/// second rename fails the old pack is renamed back, so there is never a moment (short of a
/// crash between the two renames, which [`recover`] repairs) without a pack on disk.
fn swap_in(staging: &Path, dest: &Path) -> io::Result<()> {
    let old = sibling(dest, "old");
    remove_dir_if_exists(&old)?;
    let had_old = match fs::rename(dest, &old) {
        Ok(()) => true,
        Err(e) if e.kind() == io::ErrorKind::NotFound => false,
        Err(e) => return Err(e),
    };
    if let Err(e) = fs::rename(staging, dest) {
        if had_old {
            let _ = fs::rename(&old, dest);
        }
        return Err(e);
    }
    if had_old {
        // Best effort: a leftover `.old` is removed by the next recover().
        let _ = fs::remove_dir_all(&old);
    }
    Ok(())
}

/// Undo an interrupted [`swap_in`]: with no pack at `dest`, the aside copy becomes the pack
/// again; with one, the aside copy is stale and removed.
fn recover(dest: &Path) {
    let old = sibling(dest, "old");
    if !old.exists() {
        return;
    }
    if dest.exists() {
        let _ = fs::remove_dir_all(&old);
    } else {
        let _ = fs::rename(&old, dest);
    }
}

/// The installed pack, or `None` when there isn't a (readable) one.
pub fn read_pack(dir: &Path) -> Result<Option<CharacterPack>, String> {
    recover(dir);
    let manifest_bytes = match fs::read(dir.join(MANIFEST)) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("read {MANIFEST}: {e}")),
    };
    let manifest: Value = match serde_json::from_slice(&manifest_bytes) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[hermes-buddy] ignoring corrupt stored character manifest: {e}");
            return Ok(None);
        }
    };
    let mut files = BTreeMap::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let Ok(file_name) = entry.file_name().into_string() else {
            continue;
        };
        if is_gif_name(&file_name) && entry.file_type().is_ok_and(|t| t.is_file()) {
            let bytes = fs::read(entry.path()).map_err(|e| format!("read {file_name}: {e}"))?;
            files.insert(file_name, STANDARD.encode(bytes));
        }
    }
    let name = pack_name(&manifest, dir);
    Ok(Some(CharacterPack {
        name,
        manifest,
        files,
    }))
}

/// Remove the installed pack and any staging / aside copies next to it (an aside copy left
/// behind would otherwise be "recovered" back into place).
pub fn delete(dir: &Path) -> io::Result<()> {
    let results = [
        remove_dir_if_exists(&sibling(dir, "old")),
        remove_dir_if_exists(&sibling(dir, "staging")),
        remove_dir_if_exists(dir),
    ];
    results.into_iter().collect()
}

fn remove_dir_if_exists(dir: &Path) -> io::Result<()> {
    match fs::remove_dir_all(dir) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

fn too_big() -> String {
    format!("pack is larger than {} MB", MAX_PACK_BYTES / (1024 * 1024))
}

/// `manifest.name`, else the folder name.
fn pack_name(manifest: &Value, folder: &Path) -> String {
    let from_manifest = manifest
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|n| !n.is_empty());
    let name = from_manifest
        .map(str::to_owned)
        .or_else(|| folder.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "character".into());
    name.chars().take(MAX_NAME_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const GIF: &[u8] = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;";

    /// A "GIF" of exactly `n` bytes: real magic, padding after it.
    fn gif_of_len(n: usize) -> Vec<u8> {
        let mut v = GIF.to_vec();
        v.resize(n, 0);
        v
    }

    fn write_pack(dir: &Path, manifest: Value, gifs: &[&str]) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        for g in gifs {
            fs::write(dir.join(g), GIF).unwrap();
        }
    }

    #[test]
    fn installs_a_valid_pack_and_copies_only_manifest_and_gifs() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bufo");
        write_pack(
            &src,
            json!({"name": "Bufo", "states": {"idle": "idle.gif", "busy": ["a.gif", "b.GIF"]}}),
            &["idle.gif", "a.gif", "b.GIF"],
        );
        fs::write(src.join("README.txt"), b"hi").unwrap();
        fs::write(src.join("._idle.gif"), b"junk").unwrap();
        fs::create_dir(src.join("sub")).unwrap();
        fs::write(src.join("sub/deep.gif"), GIF).unwrap();
        fs::write(src.join("script.sh"), b"#!/bin/sh").unwrap();

        let dest = tmp.path().join("data/character");
        let pack = install(&src, &dest).unwrap();
        assert_eq!(pack.name, "Bufo");
        assert_eq!(
            pack.files.keys().cloned().collect::<Vec<_>>(),
            vec!["a.gif", "b.GIF", "idle.gif"]
        );
        assert_eq!(STANDARD.decode(&pack.files["idle.gif"]).unwrap(), GIF);
        assert_eq!(pack.manifest["states"]["idle"], "idle.gif");

        let mut on_disk: Vec<_> = fs::read_dir(&dest)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        on_disk.sort();
        assert_eq!(on_disk, vec!["a.gif", "b.GIF", "idle.gif", "manifest.json"]);
        assert!(!tmp.path().join("data/.character.staging").exists());

        // get_character round-trips to the same pack.
        assert_eq!(read_pack(&dest).unwrap(), Some(pack));
    }

    #[test]
    fn name_falls_back_to_folder_and_survives_reload() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("my-frog");
        write_pack(&src, json!({"states": {"idle": "idle.gif"}}), &["idle.gif"]);
        let dest = tmp.path().join("character");
        let pack = install(&src, &dest).unwrap();
        assert_eq!(pack.name, "my-frog");
        assert_eq!(pack.manifest["name"], "my-frog");
        assert_eq!(read_pack(&dest).unwrap().unwrap().name, "my-frog");

        // blank name counts as missing
        let src2 = tmp.path().join("other");
        write_pack(&src2, json!({"name": "  ", "states": {}}), &["x.gif"]);
        assert_eq!(install(&src2, &dest).unwrap().name, "other");
    }

    #[test]
    fn reinstall_replaces_the_previous_pack() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let a = tmp.path().join("a");
        write_pack(
            &a,
            json!({"name": "A", "states": {"idle": "one.gif"}}),
            &["one.gif"],
        );
        install(&a, &dest).unwrap();
        let b = tmp.path().join("b");
        write_pack(
            &b,
            json!({"name": "B", "states": {"idle": "two.gif"}}),
            &["two.gif"],
        );
        let pack = install(&b, &dest).unwrap();
        assert_eq!(pack.name, "B");
        assert!(!dest.join("one.gif").exists());
        assert!(dest.join("two.gif").exists());
    }

    #[test]
    fn rejects_bad_packs_without_touching_the_installed_one() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let good = tmp.path().join("good");
        write_pack(
            &good,
            json!({"name": "Good", "states": {"idle": "i.gif"}}),
            &["i.gif"],
        );
        install(&good, &dest).unwrap();

        // not a folder / missing manifest
        assert!(install(&tmp.path().join("nope"), &dest).is_err());
        let empty = tmp.path().join("empty");
        fs::create_dir(&empty).unwrap();
        assert!(install(&empty, &dest)
            .unwrap_err()
            .contains("manifest.json"));

        // manifest is not JSON
        let bad_json = tmp.path().join("bad_json");
        write_pack(&bad_json, json!({}), &["i.gif"]);
        fs::write(bad_json.join("manifest.json"), b"{nope").unwrap();
        assert!(install(&bad_json, &dest)
            .unwrap_err()
            .contains("not valid JSON"));

        // no states / states of the wrong type
        for manifest in [
            json!({"name": "x"}),
            json!({"states": "idle.gif"}),
            json!([1, 2]),
            json!(null),
        ] {
            let d = tmp.path().join("no_states");
            let _ = fs::remove_dir_all(&d);
            write_pack(&d, manifest, &["i.gif"]);
            assert!(install(&d, &dest).unwrap_err().contains("states"), "{d:?}");
        }

        // no gifs
        let no_gifs = tmp.path().join("no_gifs");
        write_pack(&no_gifs, json!({"states": {}}), &[]);
        assert!(install(&no_gifs, &dest).unwrap_err().contains("no .gif"));

        // the good pack is still there
        assert_eq!(read_pack(&dest).unwrap().unwrap().name, "Good");
        assert!(!tmp.path().join(".character.staging").exists());
    }

    #[test]
    fn enforces_the_size_cap() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let src = tmp.path().join("big");
        write_pack(&src, json!({"states": {}}), &[]);
        // 2 x 2.5 MB > 4 MB, but each alone fits.
        let blob = gif_of_len(2_621_440);
        fs::write(src.join("a.gif"), &blob).unwrap();
        install(&src, &dest).unwrap();
        fs::write(src.join("b.gif"), &blob).unwrap();
        let err = install(&src, &dest).unwrap_err();
        assert!(err.contains("larger than 4 MB"), "{err}");
        // the earlier install survived the failed one
        assert!(dest.join("a.gif").exists() && !dest.join("b.gif").exists());

        // exactly at the cap is fine
        let src2 = tmp.path().join("exact");
        write_pack(&src2, json!({"states": {}}), &[]);
        let manifest_len = fs::metadata(src2.join("manifest.json")).unwrap().len();
        fs::write(
            src2.join("x.gif"),
            gif_of_len((MAX_PACK_BYTES - manifest_len) as usize),
        )
        .unwrap();
        install(&src2, &dest).unwrap();
        fs::write(src2.join("y.gif"), GIF).unwrap();
        assert!(install(&src2, &dest).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_gifs_are_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let secret = tmp.path().join("secret.gif");
        fs::write(&secret, b"top secret").unwrap();
        let src = tmp.path().join("p");
        write_pack(&src, json!({"states": {}}), &["real.gif"]);
        std::os::unix::fs::symlink(&secret, src.join("link.gif")).unwrap();
        let pack = install(&src, &tmp.path().join("character")).unwrap();
        assert_eq!(
            pack.files.keys().cloned().collect::<Vec<_>>(),
            vec!["real.gif"]
        );
    }

    #[test]
    fn picks_the_first_dir_with_a_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("file.txt");
        fs::write(&file, b"x").unwrap();
        let plain = tmp.path().join("plain");
        fs::create_dir(&plain).unwrap();
        let first = tmp.path().join("first");
        write_pack(&first, json!({"states": {}}), &["a.gif"]);
        let second = tmp.path().join("second");
        write_pack(&second, json!({"states": {}}), &["a.gif"]);
        let missing = tmp.path().join("missing");

        let paths = vec![file.clone(), missing, plain.clone(), first.clone(), second];
        assert_eq!(pick_pack_dir(&paths), Some(first.as_path()));
        assert_eq!(pick_pack_dir(&[file, plain]), None);
        assert_eq!(pick_pack_dir(&[]), None);
    }

    #[test]
    fn read_and_delete_handle_absence() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        assert_eq!(read_pack(&dest).unwrap(), None);
        delete(&dest).unwrap();
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("manifest.json"), b"garbage").unwrap();
        assert_eq!(read_pack(&dest).unwrap(), None);
        delete(&dest).unwrap();
        assert!(!dest.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_manifest_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let elsewhere = tmp.path().join("private.json");
        fs::write(
            &elsewhere,
            br#"{"states":{"idle":"idle.gif"},"api_key":"s3cret"}"#,
        )
        .unwrap();
        let src = tmp.path().join("p");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("idle.gif"), GIF).unwrap();
        std::os::unix::fs::symlink(&elsewhere, src.join("manifest.json")).unwrap();
        let dest = tmp.path().join("character");
        let err = install(&src, &dest).unwrap_err();
        assert!(
            err.contains("manifest.json") && err.contains("link"),
            "{err}"
        );
        assert!(!dest.exists(), "nothing was installed");
        assert!(!tmp.path().join(".character.staging").exists());
    }

    #[test]
    fn every_file_a_state_names_must_be_in_the_pack() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let good = tmp.path().join("good");
        write_pack(
            &good,
            json!({"name": "Good", "states": {"idle": "i.gif"}}),
            &["i.gif"],
        );
        install(&good, &dest).unwrap();

        let cases = [
            (json!({"states": {"idle": "nope.gif"}}), "nope.gif"),
            (
                json!({"states": {"idle": "i.gif", "busy": ["i.gif", "gone.gif"]}}),
                "gone.gif",
            ),
            (json!({"states": {"sleep": "sub/i.gif"}}), "sub/i.gif"),
            (json!({"states": {"sleep": "../i.gif"}}), "../i.gif"),
            (json!({"states": {"sleep": "C:\\i.gif"}}), "C:\\i.gif"),
            (json!({"states": {"heart": "I.GIF"}}), "I.GIF"), // exact names, as the UI looks them up
            (json!({"states": {"heart": "readme.txt"}}), "readme.txt"),
        ];
        for (manifest, culprit) in cases {
            let src = tmp.path().join("bad");
            let _ = fs::remove_dir_all(&src);
            write_pack(&src, manifest.clone(), &["i.gif"]);
            fs::write(src.join("readme.txt"), b"x").unwrap();
            let err = install(&src, &dest).unwrap_err();
            assert!(err.contains(culprit), "{manifest}: {err}");
            assert!(err.len() < 80, "short enough for a toast: {err}");
        }
        // The installed pack survived all of that.
        assert_eq!(read_pack(&dest).unwrap().unwrap().name, "Good");

        // Non-string entries are the UI's business (it skips them), not an install failure.
        let odd = tmp.path().join("odd");
        write_pack(
            &odd,
            json!({"states": {"idle": "i.gif", "busy": [1, null, "i.gif"], "heart": {"frames": []}}}),
            &["i.gif"],
        );
        install(&odd, &dest).unwrap();
    }

    #[test]
    fn every_gif_must_start_with_gif_magic() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let good = tmp.path().join("good");
        write_pack(&good, json!({"name": "Good", "states": {}}), &["i.gif"]);
        install(&good, &dest).unwrap();

        for (bytes, ok) in [
            (&b"GIF87a...."[..], true),
            (&b"GIF89a...."[..], true),
            (&b"GIF88a...."[..], false),
            (&b"GIF89"[..], false),
            (&b"<html>not a gif</html>"[..], false),
            (&b"\x89PNG\r\n"[..], false),
            (&b""[..], false),
        ] {
            let src = tmp.path().join("p");
            let _ = fs::remove_dir_all(&src);
            write_pack(&src, json!({"states": {"idle": "a.gif"}}), &["a.gif"]);
            fs::write(src.join("junk.gif"), bytes).unwrap();
            let r = install(&src, &dest);
            assert_eq!(r.is_ok(), ok, "{:?}: {r:?}", String::from_utf8_lossy(bytes));
            if let Err(e) = r {
                assert!(e.contains("junk.gif") && e.contains("GIF"), "{e}");
            }
        }
    }

    #[test]
    fn the_number_of_files_is_capped() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let src = tmp.path().join("many");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("manifest.json"), br#"{"states":{}}"#).unwrap();
        for i in 0..MAX_FILES {
            fs::write(src.join(format!("f{i}.gif")), GIF).unwrap();
        }
        install(&src, &dest).unwrap();
        assert_eq!(read_pack(&dest).unwrap().unwrap().files.len(), MAX_FILES);

        fs::write(src.join("one-too-many.gif"), GIF).unwrap();
        let err = install(&src, &dest).unwrap_err();
        assert!(
            err.contains("too many") && err.contains(&MAX_FILES.to_string()),
            "{err}"
        );
        assert_eq!(
            read_pack(&dest).unwrap().unwrap().files.len(),
            MAX_FILES,
            "old pack kept"
        );

        // Thousands of files: refused, whatever they contain.
        for i in 0..3000 {
            fs::write(src.join(format!("g{i}.gif")), b"").unwrap();
        }
        assert!(install(&src, &dest).unwrap_err().contains("too many"));
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn a_failed_swap_rolls_back_to_the_previous_pack() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let a = tmp.path().join("a");
        write_pack(
            &a,
            json!({"name": "A", "states": {"idle": "one.gif"}}),
            &["one.gif"],
        );
        install(&a, &dest).unwrap();

        // The staged directory is gone by the time of the second rename.
        let err = swap_in(&tmp.path().join("no-such-staging"), &dest).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert_eq!(
            read_pack(&dest).unwrap().unwrap().name,
            "A",
            "previous pack restored"
        );
        assert_eq!(
            names(tmp.path()),
            vec!["a", "character"],
            "no .old left behind"
        );
    }

    #[test]
    fn the_swap_moves_the_old_pack_aside_and_cleans_up() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let staging = tmp.path().join(".character.staging");
        write_pack(&staging, json!({"name": "New", "states": {}}), &["n.gif"]);
        swap_in(&staging, &dest).unwrap(); // nothing to move aside the first time
        assert_eq!(read_pack(&dest).unwrap().unwrap().name, "New");
        write_pack(&staging, json!({"name": "Newer", "states": {}}), &["m.gif"]);
        swap_in(&staging, &dest).unwrap();
        assert_eq!(read_pack(&dest).unwrap().unwrap().name, "Newer");
        assert_eq!(names(tmp.path()), vec!["character"]);
    }

    #[test]
    fn a_swap_interrupted_between_the_renames_is_recovered() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        let old = tmp.path().join(".character.old");
        write_pack(&old, json!({"name": "Survivor", "states": {}}), &["s.gif"]);
        // Crashed after dest -> .old but before staging -> dest: reading finds the survivor.
        assert_eq!(read_pack(&dest).unwrap().unwrap().name, "Survivor");
        assert!(dest.exists() && !old.exists());

        // A stale .old next to a good dest is just removed.
        write_pack(&old, json!({"name": "Stale", "states": {}}), &["x.gif"]);
        assert_eq!(read_pack(&dest).unwrap().unwrap().name, "Survivor");
        assert!(!old.exists());

        // Installing over an interrupted swap leaves nothing stale either.
        write_pack(&old, json!({"name": "Stale", "states": {}}), &["x.gif"]);
        fs::remove_dir_all(&dest).unwrap();
        let src = tmp.path().join("src");
        write_pack(&src, json!({"name": "Fresh", "states": {}}), &["f.gif"]);
        assert_eq!(install(&src, &dest).unwrap().name, "Fresh");
        assert_eq!(names(tmp.path()), vec!["character", "src"]);
    }

    #[test]
    fn delete_removes_the_leftovers_too() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("character");
        write_pack(&dest, json!({"states": {}}), &["a.gif"]);
        write_pack(
            &tmp.path().join(".character.old"),
            json!({"states": {}}),
            &["a.gif"],
        );
        write_pack(
            &tmp.path().join(".character.staging"),
            json!({"states": {}}),
            &["a.gif"],
        );
        delete(&dest).unwrap();
        assert!(names(tmp.path()).is_empty(), "{:?}", names(tmp.path()));
        // ...so a deleted pack can't come back through recovery.
        assert_eq!(read_pack(&dest).unwrap(), None);
    }
}
