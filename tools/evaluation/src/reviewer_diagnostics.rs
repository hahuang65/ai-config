//! Failure metadata is an allowlist, never a redaction of arbitrary provider text.
use crate::change_types;
use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Category {
    ProcessExit,
    ProcessFailure,
    ProcessTimeout,
    ProcessInterrupted,
    EventStreamLimit,
    StderrLimit,
    ModelApiError,
    ModelOutputLimit,
    ModelAborted,
    UnfinishedToolWork,
    UnknownStopReason,
    InvalidCompletion,
    InvalidAnswer,
}

impl Category {
    fn description(self) -> &'static str {
        match self {
            Self::ProcessExit => "process exited unsuccessfully; no verified result",
            Self::ProcessFailure => {
                "process setup, execution, or cleanup failed; check the harness executable and local runtime"
            }
            Self::ProcessTimeout => {
                "process timed out; reduce the scope or adjust --timeout before retrying"
            }
            Self::ProcessInterrupted => "process interrupted; no verified result",
            Self::EventStreamLimit => {
                "event stream limit exceeded (16 MiB); reduce the review scope"
            }
            Self::StderrLimit => "stderr limit exceeded (64 KiB); no verified result",
            Self::ModelApiError => {
                "model/API error; check provider availability and authentication before retrying"
            }
            Self::ModelOutputLimit => {
                "model output limit reached; reduce the review scope or select a model with a larger output budget"
            }
            Self::ModelAborted => "model request aborted; no successful review was established",
            Self::UnfinishedToolWork => {
                "unfinished tool work; no successful review was established"
            }
            Self::UnknownStopReason => {
                "unknown or missing stop reason; no successful review was established"
            }
            Self::InvalidCompletion => {
                "invalid or incomplete completion evidence; no successful review was established"
            }
            Self::InvalidAnswer => {
                "reviewer answer was rejected; failure.json records the failed check and its shape"
            }
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub(crate) struct ProcessEvidence {
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
    pub stdout_bytes: Option<u64>,
    pub stderr_bytes: Option<u64>,
}

/// The first answer check that rejected the response.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AnswerStage {
    Parse,
    Schema,
    Content,
}

/// Structural facts about a rejected answer; never its text or model-chosen field names.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct AnswerShape {
    pub stage: AnswerStage,
    pub response_bytes: usize,
    pub fence_lines: usize,
    pub text_outside_json: bool,
    pub json_object_found: bool,
    pub json_object_valid: bool,
    pub missing_fields: Vec<&'static str>,
    pub extra_field_count: usize,
}

impl AnswerShape {
    /// Inspects the same candidate the parser falls back to: the only fenced block, else the whole response.
    pub fn of(response: &str, expected: &[&'static str]) -> Self {
        let block = change_types::fenced(response).unwrap_or(0..response.len());
        let span = response[block.clone()]
            .find('{')
            .zip(response[block.clone()].rfind('}'))
            .map(|(start, end)| (block.start + start, block.start + end))
            .filter(|(start, end)| start < end);
        let outside = match span {
            Some((start, end)) => [&response[..start], &response[end + 1..]].concat(),
            None => response.to_owned(),
        };
        let object = span.and_then(|(start, end)| {
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
                &response[start..=end],
            )
            .ok()
        });
        let keys = object.as_ref().map(|map| map.keys().collect::<Vec<_>>());
        let typed = |text: &str| serde_json::from_str::<change_types::Answer>(text).is_ok();
        let stage = if typed(response) || typed(&response[block.clone()]) {
            AnswerStage::Content
        } else if serde_json::from_str::<serde_json::Value>(&response[block]).is_ok() {
            AnswerStage::Schema
        } else {
            AnswerStage::Parse
        };
        Self {
            stage,
            response_bytes: response.len(),
            fence_lines: change_types::fence_lines(response).len(),
            text_outside_json: outside
                .lines()
                .any(|line| !line.trim().is_empty() && !change_types::is_fence(line)),
            json_object_found: span.is_some(),
            json_object_valid: object.is_some(),
            missing_fields: keys.as_ref().map_or_else(Vec::new, |keys| {
                expected
                    .iter()
                    .copied()
                    .filter(|field| !keys.iter().any(|key| key.as_str() == *field))
                    .collect()
            }),
            extra_field_count: keys.as_ref().map_or(0, |keys| {
                keys.iter()
                    .filter(|key| !expected.contains(&key.as_str()))
                    .count()
            }),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Failure {
    pub version: u8,
    pub engine: Option<&'static str>,
    pub category: Category,
    pub stop_reason: Option<&'static str>,
    pub process: ProcessEvidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<AnswerShape>,
}

impl Failure {
    pub fn new(category: Category, stop_reason: Option<&'static str>) -> Self {
        Self {
            version: 1,
            engine: None,
            category,
            stop_reason,
            process: ProcessEvidence::default(),
            answer: None,
        }
    }

    pub fn answer(
        error: anyhow::Error,
        engine: &'static str,
        process: ProcessEvidence,
        shape: AnswerShape,
    ) -> anyhow::Error {
        let mut diagnostic = Self::new(Category::InvalidAnswer, None);
        diagnostic.engine = Some(engine);
        diagnostic.process = process;
        diagnostic.answer = Some(shape);
        error.context(diagnostic)
    }

    pub fn capture(error: anyhow::Error, process: ProcessEvidence) -> anyhow::Error {
        let mut diagnostic = error
            .downcast_ref::<Self>()
            .cloned()
            .unwrap_or_else(|| Self::new(Category::ProcessFailure, None));
        diagnostic.process = process;
        diagnostic.into()
    }

    pub fn process(error: anyhow::Error, engine: &'static str) -> anyhow::Error {
        let mut diagnostic = error
            .downcast_ref::<Self>()
            .cloned()
            .unwrap_or_else(|| Self::new(Category::ProcessFailure, None));
        diagnostic.engine = Some(engine);
        diagnostic.into()
    }

    pub fn annotate(
        error: anyhow::Error,
        engine: &'static str,
        process: ProcessEvidence,
    ) -> anyhow::Error {
        let mut diagnostic = error
            .downcast_ref::<Self>()
            .cloned()
            .unwrap_or_else(|| Self::new(Category::InvalidCompletion, None));
        diagnostic.engine = Some(engine);
        diagnostic.process = process;
        if error.downcast_ref::<Self>().is_some() {
            diagnostic.into()
        } else {
            error.context(diagnostic)
        }
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Reviewer failed: {}", self.category.description())?;
        if let Some(engine) = self.engine {
            write!(f, "; engine={engine}")?;
        }
        if let Some(reason) = self.stop_reason {
            write!(f, "; stopReason={reason}")?;
        }
        if let Some(code) = self.process.exit_code {
            write!(f, "; exit={code}")?;
        }
        if let Some(signal) = self.process.signal {
            write!(f, "; signal={signal}")?;
        }
        if let Some(count) = self.process.stdout_bytes {
            write!(f, "; stdoutBytes={count}")?;
        }
        if let Some(count) = self.process.stderr_bytes {
            write!(f, "; stderrBytes={count}")?;
        }
        write!(f, ". Raw provider text and stderr are withheld.")
    }
}
impl std::error::Error for Failure {}
