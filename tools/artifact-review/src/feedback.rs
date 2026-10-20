use crate::paths::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Origin {
    pub harness: String,
    pub conversation: String,
    pub workspace: PathBuf,
}

impl Origin {
    pub fn validated(self) -> Result<Self> {
        if !["pi", "claude"].contains(&self.harness.as_str())
            || self.conversation.trim().is_empty()
            || self.conversation.len() > 8192
            || self.conversation.chars().any(char::is_control)
            || !self.workspace.is_absolute()
        {
            return Err("Feedback needs a known harness, conversation and absolute workspace.");
        }
        let workspace = self
            .workspace
            .canonicalize()
            .map_err(|_| "Cannot resolve feedback workspace.")?;
        if !workspace.is_dir() || workspace.parent().is_none() {
            return Err("Feedback workspace must be an existing non-root directory.");
        }
        Ok(Self { workspace, ..self })
    }
}

#[derive(Deserialize, Serialize)]
pub struct Processing {
    pub state: String,
    pub pending: u64,
    pub responder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_cursor: Option<i64>,
}

#[derive(Deserialize, Serialize)]
pub struct Inbox {
    pub open: bool,
    pub processing: Processing,
    pub pending: Option<Pending>,
}

#[derive(Deserialize, Serialize)]
pub struct Pending {
    pub cursor: i64,
    pub event: crate::model::Event,
    pub current_revision: String,
    pub stale: bool,
    pub interrupted: bool,
}

#[derive(Deserialize, Serialize)]
pub struct Job {
    pub cursor: i64,
    pub attempt: String,
    pub event: crate::model::Event,
    pub current_revision: String,
    pub stale: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Lease {
    pub cursor: i64,
    pub attempt: String,
}

impl Lease {
    pub fn validate(&self) -> Result<()> {
        if self.cursor <= 0
            || self.attempt.len() != 32
            || !self.attempt.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("Invalid feedback lease.");
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Finish {
    pub cursor: i64,
    pub attempt: String,
    pub message: String,
}

impl Finish {
    pub fn lease(&self) -> Lease {
        Lease {
            cursor: self.cursor,
            attempt: self.attempt.clone(),
        }
    }

    pub fn reply(&self) -> crate::model::Submission {
        crate::model::Submission {
            id: format!("feedback-reply-{}-{}", self.cursor, self.attempt),
            action: "reply".into(),
            message: self.message.clone(),
            revision: String::new(),
            annotations: vec![],
            finding: None,
        }
    }
}
