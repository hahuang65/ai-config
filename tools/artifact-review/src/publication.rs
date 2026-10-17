use crate::{
    model,
    paths::{Paths, Result},
    store::Store,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

pub use evaluation::publication::Selection;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Confirmation {
    pub token: String,
}

pub enum Action {
    Information,
    Preview(Selection),
    Confirm(String),
    Reconcile,
}

pub fn execute(paths: &Paths, store: &Arc<Mutex<Store>>, action: Action) -> Result<Value> {
    let revision = model::revision(paths)?;
    let binding = store
        .lock()
        .map_err(|_| "Cannot read publication binding.")?
        .finding_review(Some(&revision))?;
    let Some(binding) = binding else {
        return match action {
            Action::Information => Ok(json!({"available": false})),
            _ => Err("Publication needs a bound change-review report."),
        };
    };
    if binding.needs_review || binding.revision != revision {
        return Err("Report changed; obtain a fresh review before publishing.");
    }
    let roots =
        evaluation::publication::source_context(&paths.artifact, &binding.report_digest, &revision)
            .map_err(|_| "Cannot restore retained source exclusions.")?;
    let result = evaluation::change_command::with_sources(&roots, || match action {
        Action::Information => {
            evaluation::publication::information(&paths.artifact, &binding.report_digest, &revision)
        }
        Action::Preview(selection) => evaluation::publication::prepare(
            &paths.artifact,
            &binding.report_digest,
            &revision,
            &selection,
        ),
        Action::Confirm(token) => evaluation::publication::confirm(
            &paths.artifact,
            &binding.report_digest,
            &revision,
            &token,
        ),
        Action::Reconcile => {
            evaluation::publication::reconcile(&paths.artifact, &binding.report_digest, &revision)
        }
    });
    result.map_err(|_| "Publication unavailable: the report, comment selection, account, or PR may have changed. Check status; an uncertain attempt must be reconciled, never resubmitted.")
}
