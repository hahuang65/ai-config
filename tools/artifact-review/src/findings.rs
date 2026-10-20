use crate::paths::{MAX_ARTIFACT, Result, hash};
use serde::{Deserialize, Serialize};
use std::{fs::OpenOptions, io::Read, os::unix::fs::OpenOptionsExt, path::Path};

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Label {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub revision: String,
    pub report_digest: String,
    pub items: Vec<Label>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub publication_only: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub read_only: bool,
}

#[derive(Deserialize)]
struct Report {
    version: u32,
    html_digest: String,
    findings: Vec<Label>,
    #[serde(default)]
    scope: serde_json::Value,
}

impl Binding {
    pub fn read(path: &Path) -> Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|_| "Cannot read findings report JSON.")?;
        if !file
            .metadata()
            .map_err(|_| "Cannot inspect findings report.")?
            .is_file()
        {
            return Err("Findings report must be a regular file, not a link.");
        }
        let mut bytes = Vec::new();
        file.take(MAX_ARTIFACT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read findings report JSON.")?;
        if bytes.len() as u64 > MAX_ARTIFACT {
            return Err("Findings report exceeds 25 MiB.");
        }
        let report: Report = serde_json::from_slice(&bytes)
            .map_err(|_| "Expected a version-1 change-review report JSON.")?;
        if report.version != 1 {
            return Err("Unsupported findings report version.");
        }
        let binding = Self {
            revision: report.html_digest,
            report_digest: hash(&bytes),
            items: report.findings,
            publication_only: report.scope["pull_request"].is_object(),
            read_only: false,
        };
        binding.validate()?;
        Ok(binding)
    }

    pub fn validate(&self) -> Result<()> {
        if !digest(&self.revision) || !digest(&self.report_digest) || self.items.len() > 50 {
            return Err("Invalid findings digests or more than 50 findings.");
        }
        for (index, item) in self.items.iter().enumerate() {
            if item.id != format!("F{}", index + 1)
                || item.title.trim().is_empty()
                || item.title.len() > 500
                || item.title.chars().any(|c| {
                    (c.is_control() && !matches!(c, '\n' | '\t'))
                        || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
                })
            {
                return Err("Findings need sequential F1–F50 IDs and titles of 1–500 bytes.");
            }
        }
        Ok(())
    }
}

fn is_false(value: &bool) -> bool {
    !value
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Deserialize, Serialize)]
pub struct Decision {
    #[serde(flatten)]
    pub label: Label,
    pub decision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
pub struct Review {
    pub publication_only: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub read_only: bool,
    pub revision: String,
    pub report_digest: String,
    pub items: Vec<Decision>,
    pub needs_review: bool,
}

impl Review {
    pub fn complete(&self) -> bool {
        !self.publication_only
            && !self.read_only
            && self.items.iter().all(|item| item.decision.is_some())
    }
}
