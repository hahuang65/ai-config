//! Display only snapshot reads accepted by the native stream validators.
use crate::{
    change_html, change_progress::Progress, reviewer_claude_stream, reviewer_process::Observation,
    reviewer_stream,
};
use anyhow::Result;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

const MAX_LINE: usize = 512 * 1024;
const DISPLAYED_PATHS: usize = 50;

enum Stream {
    Pi(reviewer_stream::Stream),
    Claude(reviewer_claude_stream::Stream),
}

impl Stream {
    fn accept(&mut self, event: Value, root: &Path) -> Result<Option<String>> {
        match self {
            Self::Pi(stream) => stream.accept(event, root),
            Self::Claude(stream) => stream.accept(event, root),
        }
    }
}

struct Activity {
    stream: Stream,
    root: PathBuf,
    line: Vec<u8>,
    disabled: bool,
    reads: Arc<AtomicUsize>,
    progress: Arc<Progress>,
}

impl Activity {
    fn feed(&mut self, bytes: &[u8]) {
        for byte in bytes {
            if self.disabled {
                return;
            }
            if *byte == b'\n' {
                if !self.line.is_empty() && self.event().is_err() {
                    self.disabled = true;
                }
                self.line.clear();
            } else if self.line.len() < MAX_LINE {
                self.line.push(*byte);
            } else {
                self.disabled = true;
                self.line.clear();
            }
        }
    }

    fn event(&mut self) -> Result<()> {
        let event = serde_json::from_slice(&self.line)?;
        if let Some(path) = self.stream.accept(event, &self.root)? {
            let reads = self.reads.fetch_add(1, Ordering::Relaxed) + 1;
            if reads <= DISPLAYED_PATHS {
                let safe = change_html::terminal(&path)
                    .replace('\n', "\\n")
                    .replace('\t', "\\t");
                let name: String = safe.chars().take(160).collect();
                let suffix = if safe.chars().count() > 160 {
                    "…"
                } else {
                    ""
                };
                let plural = if reads == 1 { "" } else { "s" };
                self.progress.activity(
                    "READ",
                    &format!("{name}{suffix} ({reads} evidence file{plural} inspected)"),
                );
            } else if reads == DISPLAYED_PATHS + 1 {
                self.progress.activity(
                    "INFO",
                    "Further file names omitted; the full read list is in report.json",
                );
            } else if reads.is_multiple_of(25) {
                self.progress
                    .activity("INFO", &format!("{reads} evidence files inspected"));
            }
        }
        Ok(())
    }
}

pub(crate) fn observer(root: &Path, claude: bool, progress: Arc<Progress>) -> Observation {
    let waiting = progress.clone();
    let reads = Arc::new(AtomicUsize::new(0));
    let observed = reads.clone();
    let mut activity = Activity {
        stream: if claude {
            Stream::Claude(Default::default())
        } else {
            Stream::Pi(Default::default())
        },
        root: root.to_owned(),
        line: Vec::new(),
        disabled: false,
        reads,
        progress,
    };
    let started = Instant::now();
    let mut last = started;
    Observation {
        bytes: Box::new(move |bytes| activity.feed(bytes)),
        tick: Box::new(move || {
            if last.elapsed() >= Duration::from_secs(5) {
                last = Instant::now();
                waiting.activity(
                    "WAIT",
                    &format!(
                        "Reviewer running: {} evidence files inspected; {}s elapsed",
                        observed.load(Ordering::Relaxed),
                        started.elapsed().as_secs()
                    ),
                );
            }
        }),
    }
}
