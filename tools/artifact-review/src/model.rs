pub use crate::artifact::{revision, snapshot};
use crate::paths::Result;
use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE: usize = 8000;
pub const MAX_ANNOTATIONS: usize = 16;
pub const PAGE_SIZE: usize = 50;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Annotation {
    pub kind: String,
    pub target: String,
    pub text: String,
    pub comment: String,
    pub revision: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Submission {
    pub id: String,
    pub action: String,
    pub revision: String,
    pub message: String,
    pub annotations: Vec<Annotation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finding: Option<String>,
}

impl Submission {
    pub fn validate(&self) -> Result<()> {
        if !valid_id(&self.id)
            || ![
                "feedback", "approve", "decline", "reply", "accept", "reject",
            ]
            .contains(&self.action.as_str())
        {
            return Err("Invalid submission ID or action.");
        }
        let decision = matches!(self.action.as_str(), "accept" | "reject");
        if decision != self.finding.is_some()
            || self
                .finding
                .as_ref()
                .is_some_and(|id| !(1..=50).any(|n| *id == format!("F{n}")))
        {
            return Err("Accept or reject requires exactly one finding ID (F1–F50).");
        }
        if self.message.len() > MAX_MESSAGE || self.annotations.len() > MAX_ANNOTATIONS {
            return Err("Feedback exceeds the input limit.");
        }
        if self.action != "reply" && !valid_revision(&self.revision) {
            return Err("A displayed revision is required.");
        }
        for annotation in &self.annotations {
            if !["element", "selection"].contains(&annotation.kind.as_str())
                || annotation.target.len() > 1000
                || annotation.text.len() > 2000
                || annotation.comment.len() > 4000
                || annotation.comment.trim().is_empty()
                || !valid_revision(&annotation.revision)
            {
                return Err("Invalid annotation.");
            }
        }
        if ["feedback", "reply"].contains(&self.action.as_str())
            && self.message.trim().is_empty()
            && self.annotations.is_empty()
        {
            return Err("Write feedback before sending.");
        }
        Ok(())
    }
}

pub fn valid_id(id: &str) -> bool {
    (16..=80).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn valid_revision(revision: &str) -> bool {
    revision.len() == 64 && revision.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[derive(Serialize, Deserialize)]
pub struct Event {
    pub cursor: u64,
    #[serde(flatten)]
    pub submission: Submission,
}

#[derive(Serialize, Deserialize)]
pub struct Page {
    pub cursor: u64,
    pub status: String,
    pub approved_revision: Option<String>,
    pub current_revision: Option<String>,
    pub needs_review: bool,
    pub events: Vec<Event>,
    pub more: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finding_review: Option<crate::findings::Review>,
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub revision: String,
    pub html: String,
}
