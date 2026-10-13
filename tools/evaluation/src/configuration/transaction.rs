//! Reverse completed changes on handled failure; this is not crash-atomic recovery.
use super::{Manifest, replace_link, save, settings_files};
use anyhow::Result;
use std::path::Path;

pub(super) enum Change {
    Link(super::Change),
    Settings(settings_files::Change),
}

impl Change {
    fn apply(&self, reverse: bool) -> Result<()> {
        match self {
            Self::Link(change) => {
                let (before, after) = if reverse {
                    (&change.after, &change.before)
                } else {
                    (&change.before, &change.after)
                };
                replace_link(&change.destination, before.as_deref(), after.as_deref())
            }
            Self::Settings(change) => change.apply(reverse),
        }
    }
}

pub(super) fn apply(changes: &[Change], record: &Path, manifest: &Manifest) -> Result<()> {
    let mut applied = Vec::new();
    let outcome = (|| {
        for change in changes {
            change.apply(false)?;
            applied.push(change);
        }
        save(record, manifest)
    })();
    finish(outcome, applied)
}

fn finish(outcome: Result<()>, applied: Vec<&Change>) -> Result<()> {
    if let Err(error) = outcome {
        let failures: Vec<_> = applied
            .into_iter()
            .rev()
            .filter_map(|change| change.apply(true).err().map(|failure| failure.to_string()))
            .collect();
        return Err(error.context(if failures.is_empty() {
            "Configuration switch failed; prior links and settings restored".to_owned()
        } else {
            format!(
                "Configuration switch failed; rollback incomplete: {}",
                failures.join("; ")
            )
        }));
    }
    Ok(())
}

#[cfg(test)]
#[path = "transaction_tests.rs"]
mod tests;
