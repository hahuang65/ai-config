use crate::{
    images,
    paths::{Paths, Result},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    sync::{Arc, Mutex},
};

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

#[derive(Serialize)]
pub struct Snapshot {
    pub revision: String,
    pub html: String,
}

struct ImageState {
    digest: Sha256,
    count: usize,
    total: usize,
    error: Option<&'static str>,
}

pub fn snapshot(paths: &Paths) -> Result<Snapshot> {
    let source = paths.read_artifact()?;
    let state = Arc::new(Mutex::new(ImageState {
        digest: Sha256::new_with_prefix(source.as_bytes()),
        count: 0,
        total: 0,
        error: None,
    }));
    let images = Arc::clone(&state);
    let artifact = paths.artifact.clone();
    let html = ammonia::Builder::default()
        .add_tags(
            ["style", "section", "main", "article", "aside"]
                .iter()
                .copied(),
        )
        .rm_clean_content_tags(["style"].iter().copied())
        .add_clean_content_tags(["title"].iter().copied())
        .add_generic_attributes(["id", "class", "style"].iter().copied())
        .rm_tag_attributes("a", ["href", "target"].iter().copied())
        .rm_tag_attributes("img", ["srcset"].iter().copied())
        .add_url_schemes(&["data"])
        .attribute_filter(move |element, attribute, value| {
            if element != "img" || attribute != "src" {
                return Some(Cow::Borrowed(value));
            }
            let mut state = images.lock().expect("render state lock");
            if state.error.is_some() {
                return None;
            }
            match images::prepare(&artifact, value) {
                Ok(Some((mime, bytes))) => {
                    if state.count >= images::MAX_IMAGES
                        || state.total.saturating_add(bytes.len()) > images::MAX_TOTAL_BYTES
                    {
                        state.error = Some("Too many render bytes. Approval is unavailable.");
                        return None;
                    }
                    state.count += 1;
                    state.total += bytes.len();
                    state.digest.update(b"\0render\0");
                    state.digest.update(mime.as_bytes());
                    state.digest.update((bytes.len() as u64).to_le_bytes());
                    state.digest.update(&bytes);
                    Some(Cow::Owned(format!(
                        "data:{mime};base64,{}",
                        STANDARD.encode(bytes)
                    )))
                }
                Ok(None) => None,
                Err(error) => {
                    state.error = Some(error);
                    None
                }
            }
        })
        .link_rel(None)
        .clean(&source)
        .to_string();
    let state = state.lock().expect("render state lock");
    if let Some(error) = state.error {
        return Err(error);
    }
    let revision = format!("{:x}", state.digest.clone().finalize());
    let policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'";
    Ok(Snapshot {
        revision,
        html: format!(
            "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\"></head><body>{html}</body></html>"
        ),
    })
}
