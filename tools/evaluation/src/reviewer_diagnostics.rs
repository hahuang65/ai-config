//! Failure metadata is an allowlist, never a redaction of arbitrary provider text.
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

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Failure {
    pub version: u8,
    pub engine: Option<&'static str>,
    pub category: Category,
    pub stop_reason: Option<&'static str>,
    pub process: ProcessEvidence,
}

impl Failure {
    pub fn new(category: Category, stop_reason: Option<&'static str>) -> Self {
        Self {
            version: 1,
            engine: None,
            category,
            stop_reason,
            process: ProcessEvidence::default(),
        }
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
