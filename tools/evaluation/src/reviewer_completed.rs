use super::Engine;
use crate::{
    reviewer_diagnostics::{Category, Failure, ProcessEvidence},
    reviewer_process, reviewer_stream,
};
use anyhow::{Context, Result, ensure};
use std::path::Path;

pub(super) fn completed(
    output: Result<reviewer_process::Output>,
    engine: Engine,
    snapshot: &Path,
    required_reads: &[&str],
) -> Result<(serde_json::Value, ProcessEvidence)> {
    let name = engine.name();
    let output = output.map_err(|error| Failure::process(error, name))?;
    if output.evidence.exit_code != Some(0) {
        return Err(Failure::annotate(
            Failure::new(Category::ProcessExit, None).into(),
            name,
            output.evidence,
        ));
    }
    let result = match engine {
        Engine::Pi => reviewer_stream::validate(&output.bytes, snapshot),
        Engine::Claude => crate::reviewer_claude_stream::validate(&output.bytes, snapshot),
    };
    let result = result.and_then(|response| {
        let reads = response["filesRead"]
            .as_array()
            .context("Missing reviewer read evidence")?;
        ensure!(
            required_reads
                .iter()
                .all(|path| reads.iter().any(|read| read.as_str() == Some(*path))),
            "Reviewer did not inspect required snapshot evidence"
        );
        Ok(response)
    });
    match result {
        Ok(response) => Ok((response, output.evidence)),
        Err(error) => Err(Failure::annotate(error, name, output.evidence)),
    }
}
