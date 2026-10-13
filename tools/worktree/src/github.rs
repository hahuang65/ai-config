//! Read-only merge evidence bound to the exact source and destination identity.
use crate::{Error, Result, git, process, records::Metadata, repository::Repository, text};
use serde_json::Value;

const REMOTE_ERROR: &str =
    "Cleanup requires a recognized github.com remote without embedded credentials.";
const RESPONSE_ERROR: &str = "GitHub returned an invalid response. Worktree retained.";

pub fn repository_name(url: &str) -> Result<String> {
    let candidate = if let Some(candidate) = url.strip_prefix("git@github.com:") {
        candidate
            .strip_suffix(".git")
            .filter(|name| !name.ends_with('/'))
            .unwrap_or(candidate)
            .to_owned()
    } else {
        url_repository(url).ok_or_else(|| Error::new(REMOTE_ERROR))?
    };
    let parts: Vec<_> = candidate.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || [".", ".."].contains(part)
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
        })
    {
        return Err(Error::new(REMOTE_ERROR));
    }
    Ok(candidate)
}

fn url_repository(url: &str) -> Option<String> {
    // Do not normalize dot segments or percent escapes: both must be rejected.
    // urlsplit strips leading C0/space and removes tabs/newlines before parsing.
    let url: String = url
        .trim_start_matches(|ch| ch <= ' ')
        .chars()
        .filter(|ch| !['\t', '\r', '\n'].contains(ch))
        .collect();
    let (scheme, remainder) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if !["https", "ssh"].contains(&scheme.as_str()) {
        return None;
    }
    let (authority, path) = remainder.split_once('/')?;
    let authority = if let Some((user, host)) = authority.rsplit_once('@') {
        if scheme != "ssh" || !["git", "git:"].contains(&user) {
            return None;
        }
        host
    } else {
        authority
    };
    let (host, port) = authority.split_once(':').unwrap_or((authority, ""));
    if !host.eq_ignore_ascii_case("github.com") {
        return None;
    }
    if !port.is_empty() {
        if !port.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let expected = if scheme == "https" { 443 } else { 22 };
        if port.parse::<u32>().ok()? != expected {
            return None;
        }
    }
    let path = path.strip_suffix('#').unwrap_or(path);
    let path = path.strip_suffix('?').unwrap_or(path);
    if path.contains(['?', '#']) {
        return None;
    }
    Some(
        path.trim_matches('/')
            .strip_suffix(".git")
            .unwrap_or(path.trim_matches('/'))
            .into(),
    )
}

pub fn merged_pull_request(repo: &Repository, metadata: &Metadata, head: &str) -> Result<String> {
    let remote = metadata
        .remote
        .as_deref()
        .filter(|remote| !remote.is_empty())
        .ok_or_else(|| Error::new("GitHub cleanup requires a configured remote."))?;
    let full_name = repository_name(&git::git(&repo.root, &["remote", "get-url", remote])?)?;
    let owner = full_name.split('/').next().expect("validated repository");
    let query_head = quote_plus(&format!("{owner}:{}", metadata.branch));
    let endpoint = format!("repos/{full_name}/pulls?state=closed&head={query_head}&per_page=100");
    let response = process::run(
        &repo.root,
        &["gh", "api", "--hostname", "github.com", &endpoint],
        true,
        30,
    )?;
    let payload: Value = text::json(&response.stdout).map_err(|_| Error::new(RESPONSE_ERROR))?;
    let pulls = payload
        .as_array()
        .ok_or_else(|| Error::new(RESPONSE_ERROR))?;
    for pull in pulls {
        if let Some(number) = matching_pull(pull, &full_name, metadata, head)? {
            return Ok(number);
        }
    }
    Err(Error::new(
        "No merged pull request matches this exact branch tip and integration branch. Worktree retained.",
    ))
}

fn matching_pull(
    pull: &Value,
    full_name: &str,
    metadata: &Metadata,
    head: &str,
) -> Result<Option<String>> {
    let merged_at = field(pull, "merged_at")?;
    if merged_at.is_null() {
        return Ok(None);
    }
    let number = field(pull, "number")?
        .as_number()
        .map(ToString::to_string)
        .filter(|number| number != "0" && number.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| Error::new(RESPONSE_ERROR))?;
    if field(pull, "state")? != "closed" || !merged_at.as_str().is_some_and(valid_timestamp) {
        return Err(Error::new(RESPONSE_ERROR));
    }
    let empty = serde_json::json!({});
    let source = pull.get("head").unwrap_or(&empty);
    let target = pull.get("base").unwrap_or(&empty);
    if field(source, "sha")? == head
        && field(source, "ref")? == metadata.branch.as_str()
        && matches_repository(source, full_name)?
        && field(target, "ref")? == metadata.base.as_str()
        && matches_repository(target, full_name)?
    {
        return Ok(Some(number));
    }
    Ok(None)
}

fn field<'a>(object: &'a Value, key: &str) -> Result<&'a Value> {
    Ok(object
        .as_object()
        .ok_or_else(|| Error::new(RESPONSE_ERROR))?
        .get(key)
        .unwrap_or(&Value::Null))
}

fn matches_repository(side: &Value, full_name: &str) -> Result<bool> {
    let repository = field(side, "repo")?;
    // Python's `(repo or {})` treats all empty JSON values as absent.
    if repository.is_null()
        || repository == false
        || repository == 0
        || repository == ""
        || repository.as_array().is_some_and(Vec::is_empty)
    {
        return Ok(false);
    }
    let name = field(repository, "full_name")?;
    if name.is_null() && repository.get("full_name").is_none() {
        return Ok(false);
    }
    Ok(name
        .as_str()
        .ok_or_else(|| Error::new(RESPONSE_ERROR))?
        .to_lowercase()
        == full_name.to_lowercase())
}

fn quote_plus(value: &str) -> String {
    use std::fmt::Write;
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b'-' | b'~' => {
                encoded.push(byte as char)
            }
            b' ' => encoded.push('+'),
            _ => {
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }
    encoded
}

fn valid_timestamp(value: &str) -> bool {
    let Some((date, time)) = value
        .strip_suffix(['Z', 'z'])
        .and_then(|value| value.split_once(['T', 't']))
    else {
        return false;
    };
    let mut date: Vec<_> = date.split('-').collect();
    let time: Vec<_> = time.split(':').collect();
    if date.len() != 3 || time.len() != 3 || date[0].len() != 4 {
        return false;
    }
    if date[2].len() == 2 {
        date[2] = date[2].strip_prefix(' ').unwrap_or(date[2]);
    }
    if date
        .iter()
        .chain(time.iter())
        .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return false;
    }
    if date[1..]
        .iter()
        .chain(time.iter())
        .any(|part| part.len() > 2)
    {
        return false;
    }
    let values: Vec<u32> = date
        .iter()
        .chain(time.iter())
        .filter_map(|part| part.parse().ok())
        .collect();
    valid_calendar(&values)
}

fn valid_calendar(values: &[u32]) -> bool {
    if values.len() != 6 {
        return false;
    }
    let (year, month, day, hour, minute, second) = (
        values[0], values[1], values[2], values[3], values[4], values[5],
    );
    if year == 0 || !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    (1..=days[month as usize - 1]).contains(&day)
}

#[cfg(test)]
mod tests {
    use super::{repository_name, valid_timestamp};

    #[test]
    fn supported_urls_have_exact_identity() {
        for url in [
            "git@github.com:example/project.git",
            "git@github.com:example/project",
            "https://github.com/example/project.git",
            "https://github.com/example/project",
            "https://github.com:443/example/project.git",
            "ssh://git@github.com/example/project.git",
            "ssh://git@github.com:22/example/project.git",
        ] {
            assert_eq!(repository_name(url).unwrap(), "example/project");
        }
    }

    #[test]
    fn unsafe_urls_have_a_credential_free_error() {
        for url in [
            "",
            "https://github.com/example",
            "https://github.com/../project",
            "https://github.com/example/..",
            "https://github.com/example/project/extra",
            "https://github.com/example/project?token=secret",
            "https://github.com/example/project#secret",
            "https://github.com:secret/example/project",
            "https://[github.com/example/project",
            "https://user:secret@github.com/example/project",
            "https://secret@github.com/example/project",
            "https://github.com:444/example/project",
            "ssh://user@github.com/example/project",
            "git@elsewhere.test:example/project.git",
            "https://github.com.evil.test/example/project",
            "https://github.com/example/雪🐍';",
        ] {
            assert_eq!(
                repository_name(url).unwrap_err().to_string(),
                super::REMOTE_ERROR
            );
        }
    }

    #[test]
    fn merge_timestamps_require_a_real_calendar_date() {
        assert!(valid_timestamp("2024-02-29T23:59:59Z"));
        for value in [
            "2023-02-29T10:00:00Z",
            "0000-01-01T00:00:00Z",
            "2026-06-01T24:00:00Z",
            "2026-06-01T10:00:60Z",
        ] {
            assert!(!valid_timestamp(value));
        }
    }
}
