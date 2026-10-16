use crate::{change_provider, change_types::PullRequest};
use anyhow::{Context, Result, ensure};

pub enum Subject {
    Pull(PullRequest),
    Branch {
        repository: String,
        branch: Option<String>,
    },
}

pub fn parse(url: &str) -> Result<Subject> {
    let url = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .trim_end_matches('/');
    let path = url
        .strip_prefix("https://github.com/")
        .context("Use an HTTPS github.com PR, repository, or branch URL")?;
    let parts: Vec<_> = path.split('/').collect();
    ensure!(parts.len() >= 2, "GitHub URL needs an owner and repository");
    let identity = change_provider::identity(&format!(
        "https://github.com/{}/{}/pull/1",
        parts[0], parts[1]
    ))?;
    let repository = format!("https://github.com/{}/{}", identity.owner, identity.repo);
    if parts.len() >= 4 && parts[2] == "pull" {
        ensure!(
            parts.len() == 4
                || parts.len() == 5 && ["files", "commits", "checks"].contains(&parts[4]),
            "Unsupported pull-request URL suffix"
        );
        return Ok(Subject::Pull(change_provider::identity(&format!(
            "{repository}/pull/{}",
            parts[3]
        ))?));
    }
    let branch = match parts.as_slice() {
        [_, _] => None,
        [_, _, "tree", rest @ ..] if !rest.is_empty() => Some(decode(&rest.join("/"))?),
        _ => anyhow::bail!("Use a GitHub PR, repository, or /tree/BRANCH URL"),
    };
    if let Some(branch) = &branch {
        ensure!(
            !branch.is_empty()
                && branch.len() <= 1024
                && !branch.chars().any(|c| c.is_whitespace() || c.is_control()),
            "Invalid GitHub branch"
        );
    }
    Ok(Subject::Branch { repository, branch })
}

fn decode(value: &str) -> Result<String> {
    let mut result = Vec::new();
    let mut bytes = value.as_bytes().iter().copied();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let high = char::from(bytes.next().context("Invalid URL escape")?)
                .to_digit(16)
                .context("Invalid URL escape")?;
            let low = char::from(bytes.next().context("Invalid URL escape")?)
                .to_digit(16)
                .context("Invalid URL escape")?;
            result.push((high * 16 + low) as u8);
        } else {
            result.push(byte);
        }
    }
    Ok(String::from_utf8(result)?)
}

pub fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}
