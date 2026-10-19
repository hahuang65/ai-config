use chrono::Local;
use indicatif::{ProgressBar, ProgressDrawTarget, ProgressStyle};
use std::{
    io::{IsTerminal, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Copy)]
pub(crate) enum Stage {
    Resolve,
    Freeze,
    Verify,
    Review,
    Validate,
    Save,
    Open,
}

impl Stage {
    fn label(self) -> &'static str {
        match self {
            Self::Resolve => "Resolving review target",
            Self::Freeze => "Freezing source evidence",
            Self::Verify => "Checking pull-request locations and revisions",
            Self::Review => "Running restricted reviewer",
            Self::Validate => "Validating findings",
            Self::Save => "Saving report",
            Self::Open => "Opening report in browser",
        }
    }
}

struct Running {
    stage: Stage,
    started: Instant,
}
#[derive(Default)]
struct State {
    current: Option<Running>,
    processed: u64,
    failed: bool,
}

pub(crate) struct Progress {
    enabled: bool,
    started: Instant,
    bar: Option<ProgressBar>,
    state: Mutex<State>,
    finished: AtomicBool,
}

impl Progress {
    pub(crate) fn new(json: bool) -> Arc<Self> {
        let enabled = !json;
        let bar = (enabled && std::io::stderr().is_terminal()).then(|| {
            let bar = ProgressBar::with_draw_target(Some(7), ProgressDrawTarget::stderr());
            bar.set_style(ProgressStyle::with_template(
                "{bar:24.cyan/blue} {pos}/{len} stages · {elapsed_precise} elapsed · {wide_msg}"
            ).expect("valid progress template").progress_chars("━╸─"));
            bar.enable_steady_tick(Duration::from_millis(100));
            bar
        });
        Arc::new(Self {
            enabled,
            started: Instant::now(),
            bar,
            state: Mutex::new(State::default()),
            finished: AtomicBool::new(false),
        })
    }

    fn log(&self, kind: &str, message: &str) {
        if !self.enabled {
            return;
        }
        let line = format!("[{}] {kind:<5} {message}", Local::now().format("%H:%M:%S"));
        match &self.bar {
            Some(bar) if !bar.is_hidden() => bar.println(line),
            _ => {
                let _ = writeln!(std::io::stderr(), "{line}");
            }
        }
    }

    fn close(&self, state: &mut State, success: bool) {
        if let Some(running) = state.current.take() {
            let kind = if success { "DONE" } else { "FAIL" };
            self.log(
                kind,
                &format!(
                    "{} (elapsed {:.1}s)",
                    running.stage.label(),
                    running.started.elapsed().as_secs_f64()
                ),
            );
            if success {
                state.processed += 1;
            } else {
                state.failed = true;
            }
            if let Some(bar) = &self.bar {
                bar.set_position(state.processed);
            }
        }
    }

    pub(crate) fn start(&self, stage: Stage) {
        if !self.enabled {
            return;
        }
        let mut state = self.state.lock().expect("progress state");
        self.close(&mut state, true);
        self.log("START", stage.label());
        state.current = Some(Running {
            stage,
            started: Instant::now(),
        });
        if let Some(bar) = &self.bar {
            bar.set_message(stage.label());
        }
    }

    pub(crate) fn skip(&self, stage: Stage, reason: &str) {
        if !self.enabled {
            return;
        }
        let mut state = self.state.lock().expect("progress state");
        self.close(&mut state, true);
        self.log("SKIP", &format!("{} — {reason}", stage.label()));
        state.processed += 1;
        if let Some(bar) = &self.bar {
            bar.set_position(state.processed);
        }
    }

    pub(crate) fn activity(&self, kind: &str, message: &str) {
        if !self.finished.load(Ordering::Relaxed) {
            self.log(kind, message);
        }
    }

    pub(crate) fn fail_current(&self) {
        let mut state = self.state.lock().expect("progress state");
        self.close(&mut state, false);
    }

    pub(crate) fn finish(&self, success: bool) {
        if !self.enabled {
            return;
        }
        self.finished.store(true, Ordering::Relaxed);
        let mut state = self.state.lock().expect("progress state");
        self.close(&mut state, success);
        let message = if !success {
            "Review failed"
        } else if state.failed {
            "Report ready; browser unavailable"
        } else {
            "Review complete"
        };
        if let Some(bar) = &self.bar {
            if success && !state.failed {
                bar.finish_with_message(message);
            } else {
                bar.abandon_with_message(message);
            }
        }
        let prefix = if success && !state.failed {
            String::new()
        } else {
            format!("{message}; ")
        };
        self.log(
            "TOTAL",
            &format!(
                "{prefix}{}/7 stages processed; total elapsed {:.1}s",
                state.processed,
                self.started.elapsed().as_secs_f64()
            ),
        );
    }
}
