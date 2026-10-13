//! Lossless Unix text boundaries, including Python's surrogateescape behavior.
//! Rust strings cannot contain surrogate code points. Reserve an escaped private
//! range internally; restore original bytes for processes/files and JSON escapes
//! for protocol output. Literal private-use characters are escaped too.
use crate::{Error, Result};
use serde_json::Value;
use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

const PROXY: u32 = 0xf0000;
const SURROGATE: u32 = 0xd800;
const ESCAPE: char = '\u{f0800}';
const NUMBER_KEY: &str = "$serde_json::private::Number";

fn proxy(unit: u16) -> char {
    char::from_u32(PROXY + u32::from(unit) - SURROGATE).expect("private-use character")
}

fn push_character(output: &mut String, character: char) {
    if (PROXY..=ESCAPE as u32).contains(&(character as u32)) {
        output.push(ESCAPE);
    }
    output.push(character);
}

pub fn decode(bytes: &[u8]) -> String {
    let mut remaining = bytes;
    let mut output = String::new();
    while !remaining.is_empty() {
        let (valid, invalid) = match std::str::from_utf8(remaining) {
            Ok(_) => (remaining.len(), 0),
            Err(error) => (
                error.valid_up_to(),
                error
                    .error_len()
                    .unwrap_or(remaining.len() - error.valid_up_to()),
            ),
        };
        for character in std::str::from_utf8(&remaining[..valid])
            .expect("valid prefix")
            .chars()
        {
            push_character(&mut output, character);
        }
        for byte in &remaining[valid..valid + invalid] {
            output.push(proxy(0xdc00 + u16::from(*byte)));
        }
        remaining = &remaining[valid + invalid..];
    }
    output
}

pub fn encode(text: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut characters = text.chars();
    while let Some(character) = characters.next() {
        if character == ESCAPE {
            if let Some(literal) = characters.next() {
                bytes.extend_from_slice(literal.encode_utf8(&mut [0; 4]).as_bytes());
            }
        } else if (PROXY + 0x480..=PROXY + 0x4ff).contains(&(character as u32)) {
            bytes.push((character as u32 - PROXY - 0x400) as u8);
        } else {
            bytes.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
        }
    }
    bytes
}

pub fn encodable(text: &str) -> bool {
    let mut characters = text.chars();
    while let Some(character) = characters.next() {
        if character == ESCAPE {
            characters.next();
            continue;
        }
        if (PROXY..ESCAPE as u32).contains(&(character as u32))
            && !(PROXY + 0x480..=PROXY + 0x4ff).contains(&(character as u32))
        {
            return false;
        }
    }
    true
}

pub fn character_count(text: &str) -> usize {
    let mut characters = text.chars();
    let mut count = 0;
    while let Some(character) = characters.next() {
        if character == ESCAPE {
            characters.next();
        }
        count += 1;
    }
    count
}

pub fn os(text: &str) -> OsString {
    OsString::from_vec(encode(text))
}
pub fn from_os(text: &OsStr) -> String {
    decode(text.as_bytes())
}
pub fn path(path: &Path) -> String {
    from_os(path.as_os_str())
}
pub fn pathbuf(text: &str) -> PathBuf {
    PathBuf::from(os(text))
}

pub fn ascii_json(encoded: &str) -> String {
    use std::fmt::Write;
    let mut output = String::new();
    let mut characters = encoded.chars();
    while let Some(character) = characters.next() {
        if character == ESCAPE {
            if let Some(literal) = characters.next() {
                for unit in literal.encode_utf16(&mut [0; 2]) {
                    let _ = write!(output, "\\u{unit:04x}");
                }
            }
        } else if (PROXY..ESCAPE as u32).contains(&(character as u32)) {
            let unit = SURROGATE + character as u32 - PROXY;
            let _ = write!(output, "\\u{unit:04x}");
        } else if character > '\u{7e}' {
            for unit in character.encode_utf16(&mut [0; 2]) {
                let _ = write!(output, "\\u{unit:04x}");
            }
        } else {
            output.push(character);
        }
    }
    output
}

pub fn diagnostic(encoded: &str) {
    use std::fmt::Write;
    let mut output = String::new();
    let mut characters = encoded.chars();
    while let Some(character) = characters.next() {
        if character == ESCAPE {
            if let Some(literal) = characters.next() {
                output.push(literal);
            }
        } else if (PROXY..ESCAPE as u32).contains(&(character as u32)) {
            let unit = SURROGATE + character as u32 - PROXY;
            let _ = write!(output, "\\u{unit:04x}");
        } else {
            output.push(character);
        }
    }
    eprintln!("{output}");
}

// Decode JSON string tokens separately to preserve escaped lone surrogates.
// serde_json still validates the document structure, numbers and all other syntax.
pub fn json(encoded: &str) -> Result<Value> {
    let mut sanitized = String::new();
    let mut characters = encoded.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '"' {
            sanitized.push(character);
            continue;
        }
        let mut string = json_string(&mut characters)?;
        if string == NUMBER_KEY
            && characters.clone().find(|ch| !ch.is_ascii_whitespace()) == Some(':')
        {
            // Serde reserves this object key for its internal big-number visitor.
            // Hide literal input keys during parsing, then restore them as keys,
            // so an attacker-controlled object cannot become an integer.
            string.insert(0, ESCAPE);
        }
        sanitized.push_str(&serde_json::to_string(&string).map_err(|_| invalid_json())?);
    }
    let mut value = serde_json::from_str(&sanitized).map_err(|_| invalid_json())?;
    restore_number_keys(&mut value);
    Ok(value)
}

fn restore_number_keys(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(restore_number_keys),
        Value::Object(values) => {
            if let Some(number) = values.shift_remove(&format!("{ESCAPE}{NUMBER_KEY}")) {
                values.insert(NUMBER_KEY.into(), number);
            }
            values.values_mut().for_each(restore_number_keys);
        }
        _ => (),
    }
}

fn invalid_json() -> Error {
    Error::new("Invalid JSON")
}

fn json_string(characters: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Result<String> {
    let mut output = String::new();
    while let Some(character) = characters.next() {
        match character {
            '"' => return Ok(output),
            '\\' => json_escape(characters, &mut output)?,
            character if character < ' ' => return Err(invalid_json()),
            character => output.push(character),
        }
    }
    Err(invalid_json())
}

fn json_escape(
    characters: &mut std::iter::Peekable<std::str::Chars<'_>>,
    output: &mut String,
) -> Result<()> {
    match characters.next().ok_or_else(invalid_json)? {
        '"' => output.push('"'),
        '\\' => output.push('\\'),
        '/' => output.push('/'),
        'b' => output.push('\u{8}'),
        'f' => output.push('\u{c}'),
        'n' => output.push('\n'),
        'r' => output.push('\r'),
        't' => output.push('\t'),
        'u' => unicode_escape(characters, output)?,
        _ => return Err(invalid_json()),
    }
    Ok(())
}

fn hex_unit(characters: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Result<u16> {
    let mut unit = 0;
    for _ in 0..4 {
        unit = unit * 16
            + characters
                .next()
                .and_then(|ch| ch.to_digit(16))
                .ok_or_else(invalid_json)? as u16;
    }
    Ok(unit)
}

fn unicode_escape(
    characters: &mut std::iter::Peekable<std::str::Chars<'_>>,
    output: &mut String,
) -> Result<()> {
    let first = hex_unit(characters)?;
    if (0xd800..=0xdbff).contains(&first) {
        let mut ahead = characters.clone();
        if ahead.next() == Some('\\')
            && ahead.next() == Some('u')
            && let Ok(second @ 0xdc00..=0xdfff) = hex_unit(&mut ahead)
        {
            let point = 0x10000 + ((u32::from(first) - 0xd800) << 10) + u32::from(second) - 0xdc00;
            push_character(output, char::from_u32(point).expect("surrogate pair"));
            *characters = ahead;
            return Ok(());
        }
    }
    if (0xd800..=0xdfff).contains(&first) {
        output.push(proxy(first));
    } else {
        push_character(
            output,
            char::from_u32(u32::from(first)).expect("Unicode scalar"),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_objects_cannot_impersonate_merge_proof_numbers() {
        let value = json(r#"{"number":{"$serde_json::private::Number":"123"}}"#).unwrap();
        assert!(value["number"].is_object());
    }

    #[test]
    fn unix_bytes_and_literal_private_characters_round_trip() {
        let original = [
            b"path-\xff\x80".as_slice(),
            "雪\u{f0480}\u{f0800}".as_bytes(),
        ]
        .concat();
        assert_eq!(encode(&decode(&original)), original);
    }

    #[test]
    fn json_round_trips_lone_surrogates_without_colliding_with_real_unicode() {
        let input = r#"{"path":"/tmp/\udcff", "literal":"\udb80\udc80", "emoji":"\ud83d\udc0d"}"#;
        let value = json(&decode(input.as_bytes())).unwrap();
        let serialized = ascii_json(&serde_json::to_string(&value).unwrap());
        assert_eq!(json(&decode(serialized.as_bytes())).unwrap(), value);
        assert_eq!(encode(value["path"].as_str().unwrap()), b"/tmp/\xff");
    }
}
