use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    Left,
    Right,
}

impl Side {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Left => "LEFT",
            Self::Right => "RIGHT",
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    Defect,
    Refactor,
    Reuse,
}

impl Kind {
    pub fn is_defect(&self) -> bool {
        matches!(self, Self::Defect)
    }
    pub fn label(&self) -> &'static str {
        match self {
            Self::Defect => "Defect",
            Self::Refactor => "Refactoring opportunity",
            Self::Reuse => "Reuse opportunity",
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Explanation {
    pub problem: String,
    pub impact: String,
    pub technical_details: String,
    pub suggested_fix: String,
}

impl Explanation {
    pub fn sections(&self) -> [(&'static str, &str); 4] {
        [
            ("User-facing problem", &self.problem),
            ("Why it matters", &self.impact),
            ("Technical details", &self.technical_details),
            ("Suggested fix", &self.suggested_fix),
        ]
    }

    fn body(&self) -> String {
        self.sections()
            .into_iter()
            .map(|(heading, text)| format!("{heading}:\n{text}"))
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    #[serde(default, skip_serializing_if = "Kind::is_defect")]
    pub kind: Kind,
    pub severity: Severity,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<Explanation>,
    pub path: String,
    pub line: Option<u64>,
    pub side: Side,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Answer {
    pub summary: String,
    pub intent_summary: String,
    pub risk: Severity,
    pub uncertainties: Vec<String>,
    pub findings: Vec<Proposal>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Finding {
    pub id: String,
    #[serde(flatten)]
    pub proposal: Proposal,
    pub inline: bool,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PullRequest {
    pub owner: String,
    pub repo: String,
    pub number: u64,
    pub url: String,
    pub id: u64,
    pub repository_id: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub kind: String,
    pub repository: String,
    pub base: String,
    pub head: String,
    pub comparison_base: String,
    pub path_filter: Option<String>,
    pub pull_request: Option<PullRequest>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScopeDisplay {
    pub repository: String,
    pub comparison: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    pub version: u32,
    pub scope: Scope,
    pub intent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<ScopeDisplay>,
    pub digest: String,
    pub html_digest: String,
    pub summary: String,
    pub risk: Severity,
    pub uncertainties: Vec<String>,
    pub findings: Vec<Finding>,
    pub files_read: Vec<String>,
}

#[derive(PartialEq, Eq)]
pub struct Blob {
    pub bytes: Vec<u8>,
    pub executable: bool,
}
pub type Tree = BTreeMap<String, Blob>;
pub type Exclusions = BTreeMap<String, String>;

pub fn text(value: &str, maximum: usize) -> Result<()> {
    ensure!(
        !value.trim().is_empty() && value.len() <= maximum,
        "Text is empty or exceeds its limit"
    );
    ensure!(
        !value
            .chars()
            .any(|c| (c.is_control() && !matches!(c, '\n' | '\t'))
                || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')),
        "Text contains unsafe control characters"
    );
    Ok(())
}

pub fn relative_path(path: &str) -> Result<()> {
    text(path, 1024)?;
    ensure!(
        !path.starts_with('/')
            && !path.contains(['\n', '\t', '\\'])
            && path.split('/').all(|p| !matches!(p, "" | "." | "..")),
        "Expected a safe relative file path"
    );
    Ok(())
}

pub fn private_path(path: &str) -> bool {
    path.split('/').any(|p| {
        matches!(p, ".git" | ".state" | ".pi" | "auth.json")
            || [".aws", ".ssh", ".kube"]
                .iter()
                .any(|suffix| p.ends_with(suffix))
            || [".netrc", ".npmrc", ".pgpass", ".secrets", "auth.json"]
                .iter()
                .any(|name| p.contains(name))
            || p.starts_with(".env")
            || p.starts_with("credentials")
    })
}

pub fn answer(value: &str) -> Result<Answer> {
    let mut answer: Answer = serde_json::from_str(value)
        .map_err(|_| anyhow::anyhow!("Reviewer did not return the required finding schema"))?;
    text(&answer.summary, 8000)?;
    text(&answer.intent_summary, 600)?;
    ensure!(
        answer.findings.len() <= 50 && answer.uncertainties.len() <= 32,
        "Too many findings or uncertainty statements"
    );
    for uncertainty in &answer.uncertainties {
        text(uncertainty, 2000)?;
    }
    for finding in &mut answer.findings {
        let explanation = finding.explanation.as_ref().ok_or_else(|| {
            anyhow::anyhow!("Reviewer findings require all four explanation sections")
        })?;
        for (_, section) in explanation.sections() {
            text(section, 8000)?;
        }
        finding.body = explanation.body();
        text(&finding.title, 500)?;
        text(&finding.body, 8000)?;
        relative_path(&finding.path)?;
    }
    Ok(answer)
}
