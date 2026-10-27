//! Text helpers: ASCII transliteration, char-safe truncation, and the shaping of message rows
//! into the short transcript lines shown on the stick.
//!
//! Everything that reaches the UI goes through [`clean`]: the stick's 6x8 GLCD font only has the
//! printable ASCII range, so anything else must be mapped or replaced before it leaves Rust.

use serde_json::Value;

/// A transcript line on the stick (firmware `lines[]` width).
/// One transcript entry: 8 rows of the stick's 21-column transcript strip.
pub const MAX_LINE_CHARS: usize = 168;
/// `msg` on the stick (firmware `msg[24]`).
pub const MAX_MSG_CHARS: usize = 23;
/// `model` on the stick.
pub const MAX_MODEL_CHARS: usize = 15;
/// `promptTool` on the stick (firmware `promptTool[20]`).
pub const MAX_TOOL_CHARS: usize = 19;
/// Longest transcript, in lines.
pub const MAX_LINES: usize = 8;

/// Prefix Hermes puts on structured (multimodal) message content: `"\0json:" + json`.
/// See `SessionDB._CONTENT_JSON_PREFIX` in `hermes_state.py`.
const CONTENT_JSON_PREFIX: &str = "\u{0}json:";

/// Map one char to its ASCII rendering, appending to `out`.
fn push_ascii(ch: char, out: &mut String) {
    match ch {
        // Printable ASCII passes through.
        ' '..='~' => out.push(ch),
        // Whitespace and control characters become a space (collapsed later).
        '\t' | '\n' | '\r' | '\u{0B}' | '\u{0C}' => out.push(' '),
        // Typographic spaces.
        '\u{00A0}'
        | '\u{1680}'
        | '\u{2000}'..='\u{200A}'
        | '\u{202F}'
        | '\u{205F}'
        | '\u{3000}' => out.push(' '),
        // Zero-width / invisible joiners and variation selectors vanish.
        '\u{200B}'..='\u{200F}'
        | '\u{2060}'
        | '\u{FEFF}'
        | '\u{FE0E}'
        | '\u{FE0F}'
        | '\u{00AD}' => {}
        // Dashes and minus signs.
        '\u{2010}'..='\u{2015}' | '\u{2212}' => out.push('-'),
        // Single quotes / primes / apostrophes.
        '\u{2018}'..='\u{201B}' | '\u{2032}' | '\u{00B4}' | '\u{02BC}' => out.push('\''),
        // Double quotes / double primes / guillemets.
        '\u{201C}'..='\u{201F}' | '\u{2033}' | '\u{00AB}' | '\u{00BB}' => out.push('"'),
        '\u{2026}' => out.push_str("..."),
        // Bullets and middle dots.
        '\u{2022}' | '\u{2023}' | '\u{2043}' | '\u{25CF}' | '\u{25AA}' | '\u{25E6}' => {
            out.push('*')
        }
        '\u{00B7}' | '\u{2219}' | '\u{22C5}' => out.push('.'),
        // Arrows.
        '\u{2192}' | '\u{27F6}' => out.push_str("->"),
        '\u{2190}' | '\u{27F5}' => out.push_str("<-"),
        '\u{21D2}' => out.push_str("=>"),
        '\u{00D7}' => out.push('x'),
        // Everything else the font cannot show.
        _ => out.push('?'),
    }
}

/// Transliterate common Unicode punctuation to ASCII and replace every other non-ASCII or
/// control char with `?`. Whitespace runs are *not* collapsed here; see [`clean`].
pub fn to_ascii(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        push_ascii(ch, &mut out);
    }
    out
}

/// At most `max` chars of `s`, cut on a char boundary.
pub fn truncate_chars(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

/// ASCII-fy, collapse whitespace runs to single spaces, trim, truncate to `max` chars.
/// (ASCII first so that expanding transliterations such as `...` count against `max`.)
pub fn clean(s: &str, max: usize) -> String {
    let ascii = to_ascii(s);
    let mut out = String::with_capacity(ascii.len().min(max + 1));
    let mut pending_space = false;
    for ch in ascii.chars() {
        if ch == ' ' {
            pending_space = !out.is_empty();
        } else {
            if pending_space {
                out.push(' ');
                pending_space = false;
            }
            out.push(ch);
        }
        if out.len() > max {
            break;
        }
    }
    let cut = truncate_chars(&out, max);
    cut.trim_end().to_string()
}

/// First line of `s` that carries at least one letter or digit (skips blank lines, code-fence
/// lines and pure decoration such as rules).
pub fn first_text_line(s: &str) -> Option<&str> {
    s.lines()
        .map(str::trim)
        .find(|l| !l.starts_with("```") && l.chars().any(char::is_alphanumeric))
}

/// Pull the readable text out of a stored `content` value.
///
/// Plain strings pass through. Structured content (`"\0json:" + json`, used for multimodal
/// parts) yields its first text part. The query truncates huge content, so the JSON may be cut
/// off; in that case the first `"text"` string is parsed leniently from the prefix.
pub fn content_text(raw: &str) -> Option<String> {
    let Some(json) = raw.strip_prefix(CONTENT_JSON_PREFIX) else {
        return Some(raw.to_string());
    };
    if let Ok(v) = serde_json::from_str::<Value>(json) {
        return value_text(&v);
    }
    // Truncated JSON: find `"text"` then stream-parse just that one string value.
    let mut from = 0;
    while let Some(rel) = json[from..].find("\"text\"") {
        let after = from + rel + "\"text\"".len();
        let rest = json[after..].trim_start();
        if let Some(rest) = rest.strip_prefix(':') {
            let rest = rest.trim_start();
            if let Some(Ok(s)) = serde_json::Deserializer::from_str(rest)
                .into_iter::<String>()
                .next()
            {
                return Some(s);
            }
        }
        from = after;
    }
    None
}

fn value_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Array(parts) => parts.iter().find_map(value_text),
        Value::Object(map) => map.get("text").and_then(value_text),
        _ => None,
    }
}

/// Keys that usually carry the "what is this call doing" string, most telling first.
const HINT_KEYS: &[&str] = &[
    "command",
    "cmd",
    "query",
    "path",
    "file_path",
    "filepath",
    "url",
    "pattern",
    "name",
    "text",
    "prompt",
    "question",
    "code",
    "input",
    "message",
    "description",
];

/// One-line hint for a tool call, from its raw `arguments` (a JSON string, normally).
///
/// * `clarify`: the first question - `{"questions":[{"question":..}]}` or a top-level `question`.
/// * `terminal`: the `command`.
/// * anything else: the first well-known key, else the first string value.
///
/// Unparseable arguments fall back to the raw text. The result is *not* yet cleaned.
pub fn tool_hint(tool: &str, arguments: &str) -> String {
    let args = arguments.trim();
    if args.is_empty() {
        return String::new();
    }
    let Ok(v) = serde_json::from_str::<Value>(args) else {
        // Cut off by the SQL prefix (or just malformed): read what is readable.
        if args.starts_with('{') || args.starts_with('[') {
            return lenient_hint(tool, args).unwrap_or_default();
        }
        return args.to_string();
    };
    let Value::Object(map) = &v else {
        return match v {
            Value::String(s) => s,
            _ => String::new(),
        };
    };
    let first_question = || -> Option<String> {
        match map.get("questions") {
            Some(Value::Array(qs)) => qs.iter().find_map(|q| match q {
                Value::String(s) => Some(s.clone()),
                Value::Object(o) => o
                    .get("question")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                _ => None,
            }),
            _ => None,
        }
    };
    let by_key = |k: &str| map.get(k).and_then(Value::as_str).map(str::to_string);
    let found = match tool {
        "clarify" => first_question().or_else(|| by_key("question")),
        "terminal" => by_key("command"),
        _ => None,
    };
    found
        .or_else(first_question)
        .or_else(|| HINT_KEYS.iter().find_map(|k| by_key(k)))
        .or_else(|| map.values().find_map(|x| x.as_str().map(str::to_string)))
        .unwrap_or_default()
}

/// The JSON string value that follows `"key":` in `src`, decoded, and whether its closing quote
/// arrived. The value may run off the end of `src` (the SQL prefix cuts mid-string).
fn string_after_key(src: &str, key: &str) -> Option<(String, bool)> {
    let needle = format!("\"{key}\"");
    let mut from = 0;
    while let Some(rel) = src[from..].find(&needle) {
        let after = from + rel + needle.len();
        let rest = src[after..].trim_start();
        if let Some(rest) = rest.strip_prefix(':') {
            if let Some(body) = rest.trim_start().strip_prefix('"') {
                return Some(json_string_prefix(body));
            }
        }
        from = after;
    }
    None
}

/// The `"arguments"` value of a (cut-off) call: the decoded string when it is a JSON string
/// (Hermes stores them that way), else the raw text from the value on.
fn arguments_prefix(call: &str) -> String {
    let key = "\"arguments\"";
    let Some(at) = call.find(key) else {
        return String::new();
    };
    let Some(value) = call[at + key.len()..]
        .trim_start()
        .strip_prefix(':')
        .map(str::trim_start)
    else {
        return String::new();
    };
    match value.strip_prefix('"') {
        Some(body) => json_string_prefix(body).0,
        None => value.to_string(),
    }
}

/// Decode a JSON string body (the text after the opening quote) up to its closing quote, or to
/// the end of the input when it is cut short; the flag says which. A truncated escape sequence is
/// dropped.
fn json_string_prefix(body: &str) -> (String, bool) {
    let mut out = String::new();
    let mut chars = body.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return (out, true),
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('b') => out.push('\u{8}'),
                Some('f') => out.push('\u{c}'),
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    match u32::from_str_radix(&hex, 16) {
                        // A lone surrogate half cannot be a char; the font can't show it anyway.
                        Ok(code) if hex.len() == 4 => out.push(char::from_u32(code).unwrap_or('?')),
                        _ => break,
                    }
                }
                Some(other) => out.push(other), // \" \\ \/
                None => break,
            },
            c => out.push(c),
        }
    }
    (out, false)
}

/// [`tool_hint`] for `arguments` that are not valid JSON because they were cut off: the first
/// well-known key whose string value is at least begun.
fn lenient_hint(tool: &str, args: &str) -> Option<String> {
    let first = match tool {
        "clarify" => Some("question"),
        "terminal" => Some("command"),
        _ => None,
    };
    first
        .into_iter()
        .chain(HINT_KEYS.iter().copied())
        .find_map(|k| {
            string_after_key(args, k)
                .map(|(v, _)| v)
                .filter(|v| !v.trim().is_empty())
        })
}

/// One `tool_calls` entry's `(name, arguments-as-text)`; tolerates the OpenAI shape
/// (`function.name` / `function.arguments`, arguments a string or an object) and a bare
/// `{name, arguments|input}` shape.
fn call_parts(call: &Value) -> Option<(String, String)> {
    let f = call.get("function").unwrap_or(call);
    let name = f.get("name").and_then(Value::as_str)?.to_string();
    let args = match f.get("arguments").or_else(|| f.get("input")) {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    Some((name, args))
}

/// Every call in a stored `tool_calls` value as `(name, arguments)`.
///
/// The query hands over only a byte prefix of the column (rows can hold megabytes of file
/// content), so the array may end mid-call. Complete calls are parsed normally; a cut-off last
/// call yields whatever is readable of its name and arguments.
pub fn parse_calls(raw: &str) -> Vec<(String, String)> {
    if let Ok(Value::Array(calls)) = serde_json::from_str::<Value>(raw) {
        return calls.iter().filter_map(call_parts).collect();
    }
    let Some(open) = raw.find('[') else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut rest = &raw[open + 1..];
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == ',');
        if rest.is_empty() || rest.starts_with(']') {
            break;
        }
        let mut stream = serde_json::Deserializer::from_str(rest).into_iter::<Value>();
        match stream.next() {
            Some(Ok(call)) => {
                out.extend(call_parts(&call));
                rest = &rest[stream.byte_offset()..];
            }
            _ => {
                // The cut-off call (or garbage): salvage the name and as much of the arguments
                // as arrived, then stop.
                // (A name cut in half is no name.)
                if let Some((name, true)) = string_after_key(rest, "name") {
                    if !name.is_empty() {
                        out.push((name, arguments_prefix(rest)));
                    }
                }
                break;
            }
        }
    }
    out
}

/// Hermes writes compaction summaries into the transcript as ordinary-looking rows. These are
/// their opening words (`SUMMARY_PREFIX` / `LEGACY_SUMMARY_PREFIX` in `agent/context_compressor.py`).
const SUMMARY_HEADS: &[&str] = &[
    "[CONTEXT COMPACTION \u{2014} REFERENCE ONLY] Earlier turns were compacted into the summary below.",
    "[CONTEXT SUMMARY]:",
];

/// A compaction-summary carrier, recognised by its text as Hermes's own previews do.
pub fn is_compaction_summary(content: &str) -> bool {
    let c = content.trim_start();
    SUMMARY_HEADS.iter().any(|h| c.starts_with(h))
}

/// Transcript lines contributed by one stored message, oldest first within the row.
///
/// * `user` -> `"> " + first line`
/// * `assistant` text -> first text line; each tool call -> `"<tool>: <hint>"`
/// * everything else (tool results, system, empty content) -> nothing
pub fn row_lines(role: &str, content: Option<&str>, tool_calls: Option<&str>) -> Vec<String> {
    let mut out = Vec::new();
    let body = content.and_then(content_text);
    if body.as_deref().is_some_and(is_compaction_summary) {
        return out;
    }
    let text = body.and_then(|c| first_text_line(&c).map(str::to_string));
    match role {
        "user" => {
            if let Some(t) = text {
                let line = clean(&format!("> {t}"), MAX_LINE_CHARS);
                if line.len() > 2 {
                    out.push(line);
                }
            }
        }
        "assistant" => {
            if let Some(t) = text {
                let line = clean(&t, MAX_LINE_CHARS);
                if !line.is_empty() {
                    out.push(line);
                }
            }
            for (name, args) in tool_calls.map(parse_calls).unwrap_or_default() {
                let hint = tool_hint(&name, &args);
                let line = if hint.trim().is_empty() {
                    clean(&name, MAX_LINE_CHARS)
                } else {
                    clean(&format!("{name}: {hint}"), MAX_LINE_CHARS)
                };
                if !line.is_empty() {
                    out.push(line);
                }
            }
        }
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_transliteration() {
        assert_eq!(
            to_ascii("a\u{2014}b \u{2013} \u{2018}x\u{2019} \u{201C}y\u{201D} wait\u{2026} \u{2022} go \u{2192} on"),
            "a-b - 'x' \"y\" wait... * go -> on"
        );
        assert_eq!(to_ascii("caf\u{e9} \u{1F600}\u{4E2D}"), "caf? ??");
        assert_eq!(to_ascii("a\u{200B}b\u{FE0F}"), "ab");
        assert!(to_ascii("\u{7f}\u{1b}x")
            .chars()
            .all(|c| c == '?' || c == 'x'));
    }

    #[test]
    fn truncation_is_char_safe() {
        assert_eq!(truncate_chars("h\u{e9}llo", 2), "h\u{e9}");
        assert_eq!(truncate_chars("abc", 10), "abc");
        assert_eq!(truncate_chars("", 3), "");
        assert_eq!(truncate_chars("abc", 0), "");
    }

    #[test]
    fn clean_collapses_and_caps() {
        assert_eq!(clean("  a \n\t b   c  ", 50), "a b c");
        assert_eq!(clean("abcdef", 3), "abc");
        assert_eq!(clean("ab  cd", 3), "ab");
        assert_eq!(clean("\u{2026}\u{2026}", 4), "....");
        assert_eq!(clean("", 5), "");
        let long = "word ".repeat(100);
        let c = clean(&long, 91);
        assert!(c.len() <= 91 && !c.ends_with(' '));
    }

    #[test]
    fn first_line_skips_decoration() {
        assert_eq!(first_text_line("\n\n```bash\nls\n```"), Some("ls"));
        assert_eq!(first_text_line("```\n---\nreal text"), Some("real text"));
        assert_eq!(first_text_line("   \n\n"), None);
    }

    #[test]
    fn structured_content() {
        let c =
            "\u{0}json:[{\"type\":\"text\",\"text\":\"look at this\"},{\"type\":\"image_url\"}]";
        assert_eq!(content_text(c).as_deref(), Some("look at this"));
        // truncated mid-image
        let t = "\u{0}json:[{\"type\":\"text\",\"text\":\"hi \\\"there\\\"\"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:ima";
        assert_eq!(content_text(t).as_deref(), Some("hi \"there\""));
        assert_eq!(content_text("plain").as_deref(), Some("plain"));
        assert_eq!(content_text("\u{0}json:[{\"type\":\"image_url\"}]"), None);
    }

    #[test]
    fn hints() {
        let q = r#"{"questions":[{"question":"Which one?","choices":["a","b"]},{"question":"second"}]}"#;
        assert_eq!(tool_hint("clarify", q), "Which one?");
        assert_eq!(tool_hint("clarify", r#"{"question":"flat?"}"#), "flat?");
        assert_eq!(
            tool_hint("clarify", r#"{"questions":["plain string q"]}"#),
            "plain string q"
        );
        assert_eq!(
            tool_hint("terminal", r#"{"command":"ls -la","timeout":5}"#),
            "ls -la"
        );
        assert_eq!(
            tool_hint("read_file", r#"{"limit":5,"path":"/a/b"}"#),
            "/a/b"
        );
        assert_eq!(
            tool_hint("weird", r#"{"n":1,"z":"first string"}"#),
            "first string"
        );
        assert_eq!(tool_hint("terminal", "not json {"), "not json {");
        assert_eq!(tool_hint("terminal", ""), "");
        assert_eq!(tool_hint("terminal", "{}"), "");
    }

    #[test]
    fn calls_survive_being_cut_off() {
        // Hermes's key order: id, ..., type, function { name, arguments }.
        let call = |id: &str, name: &str, args: &str| {
            format!(
                r#"{{"id":"{id}","type":"function","function":{{"name":"{name}","arguments":{}}}}}"#,
                serde_json::Value::String(args.to_string())
            )
        };
        let full = format!(
            "[{},{}]",
            call("a", "terminal", r#"{"command":"ls"}"#),
            call("b", "read_file", r#"{"path":"/x"}"#)
        );
        assert_eq!(
            parse_calls(&full),
            vec![
                ("terminal".to_string(), r#"{"command":"ls"}"#.to_string()),
                ("read_file".to_string(), r#"{"path":"/x"}"#.to_string())
            ]
        );
        // Cut anywhere inside the second call: the first survives; the second keeps its name once
        // the name has arrived, and its arguments as far as they got.
        let cut_at = |needle: &str, extra: usize| &full[..full.rfind(needle).unwrap() + extra];
        let in_args = cut_at(r#"\"path\""#, 9);
        let got = parse_calls(in_args);
        assert_eq!(got.len(), 2, "{in_args}");
        assert_eq!(got[0].0, "terminal");
        assert_eq!(got[1].0, "read_file");
        assert!(got[1].1.starts_with(r#"{"path":"#), "{:?}", got[1]);
        // Cut before the name has arrived: only the complete call.
        let before_name = cut_at(r#""function""#, 3);
        assert_eq!(parse_calls(before_name).len(), 1, "{before_name}");
        // Cut inside the first call's name.
        assert_eq!(
            parse_calls(&full[..full.find("terminal").unwrap() + 3]).len(),
            0
        );
        // Not an array / garbage.
        assert!(parse_calls("garbage").is_empty());
        assert!(parse_calls("").is_empty());
        assert!(parse_calls("[]").is_empty());
        // Object-valued arguments, cut.
        let obj = r#"[{"function":{"name":"terminal","arguments":{"command":"echo hi","cwd":"/a"#;
        assert_eq!(
            parse_calls(obj),
            vec![(
                "terminal".to_string(),
                r#"{"command":"echo hi","cwd":"/a"#.to_string()
            )]
        );
    }

    #[test]
    fn cut_off_arguments_still_give_a_hint() {
        // The key we want arrived whole, the rest of the value is missing.
        assert_eq!(
            tool_hint(
                "terminal",
                r#"{"command": "make -j4 && echo \"done\"", "pad": "xxxx"#
            ),
            r#"make -j4 && echo "done""#
        );
        // The value itself is cut: what is there is used.
        assert_eq!(
            tool_hint("terminal", r#"{"command": "cat <<'EOF' > run.sh\necho h"#),
            "cat <<'EOF' > run.sh\necho h"
        );
        assert_eq!(
            tool_hint("read_file", r#"{"limit": 5, "path": "/a/b.rs", "x": "#),
            "/a/b.rs"
        );
        assert_eq!(
            tool_hint(
                "clarify",
                r#"{"questions": [{"question": "Which one?", "choices": ["a", "#
            ),
            "Which one?"
        );
        // Escapes, including a \u escape and one cut in half.
        assert_eq!(
            tool_hint("terminal", r#"{"command": "caf\u00e9 \u00"#),
            "caf\u{e9} "
        );
        // Nothing usable: no hint, rather than a fragment of JSON.
        assert_eq!(tool_hint("write_file", r#"{"content": "yyyyyyyy"#), "");
        // A key name appearing only inside a string value is not a key.
        assert_eq!(
            tool_hint("t", r#"{"text": "say \"command\": \"no\"", "x"#),
            r#"say "command": "no""#
        );
    }

    #[test]
    fn compaction_summaries_are_recognised() {
        assert!(is_compaction_summary("[CONTEXT COMPACTION \u{2014} REFERENCE ONLY] Earlier turns were compacted into the summary below. This is..."));
        assert!(is_compaction_summary("  \n[CONTEXT SUMMARY]: earlier"));
        assert!(!is_compaction_summary("[CONTEXT] is not it"));
        assert!(!is_compaction_summary("plain"));
        assert!(row_lines("user", Some("[CONTEXT SUMMARY]: earlier"), None).is_empty());
    }

    #[test]
    fn row_shapes() {
        assert_eq!(
            row_lines("user", Some("hello\nsecond"), None),
            vec!["> hello"]
        );
        assert!(row_lines("user", Some("  \n "), None).is_empty());
        assert!(row_lines("tool", Some("{\"output\":1}"), None).is_empty());
        let calls = r#"[{"id":"t1","function":{"name":"terminal","arguments":"{\"command\":\"ls\"}"}},
                        {"id":"t2","function":{"name":"todo","arguments":"{}"}}]"#;
        assert_eq!(
            row_lines("assistant", Some("Let me look.\nmore"), Some(calls)),
            vec!["Let me look.", "terminal: ls", "todo"]
        );
        assert!(row_lines("assistant", Some(""), None).is_empty());
        assert!(row_lines("assistant", None, Some("garbage")).is_empty());
    }
}
