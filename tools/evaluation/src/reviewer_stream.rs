//! Validate Pi's JSONL completion, not its process status alone.
use crate::reviewer_diagnostics::{Category, Failure};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub(crate) const MAX_RESPONSE_BYTES: usize = 256 * 1024;

pub(crate) fn read_path(path: &str, root: &Path) -> Result<String> {
    let absolute = root
        .join(path)
        .canonicalize()
        .context("Reviewer read evidence names an unavailable file")?;
    let relative = absolute
        .strip_prefix(root)
        .context("Reviewer read evidence escaped the snapshot")?;
    ensure!(
        !relative.as_os_str().is_empty() && absolute.is_file(),
        "Reviewer read evidence is not a file"
    );
    ensure!(
        !relative
            .components()
            .any(|part| part.as_os_str() == ".git" || part.as_os_str() == ".state"),
        "Reviewer read evidence includes excluded metadata"
    );
    Ok(relative
        .to_str()
        .context("Reviewer read evidence is not UTF-8")?
        .to_owned())
}

fn final_text(message: &Value) -> Result<String> {
    let failure = match message["stopReason"].as_str() {
        Some("stop") => None,
        Some("error") => Some((Category::ModelApiError, Some("error"))),
        Some("length") => Some((Category::ModelOutputLimit, Some("length"))),
        Some("aborted") => Some((Category::ModelAborted, Some("aborted"))),
        Some("toolUse") => Some((Category::UnfinishedToolWork, Some("toolUse"))),
        _ => Some((Category::UnknownStopReason, None)),
    };
    if let Some((category, reason)) = failure {
        return Err(Failure::new(category, reason).into());
    }
    let blocks = message["content"]
        .as_array()
        .context("Reviewer response has no content")?;
    let mut text = String::new();
    for block in blocks {
        match block["type"].as_str() {
            Some("text") => text.push_str(
                block["text"]
                    .as_str()
                    .context("Reviewer text is malformed")?,
            ),
            Some("thinking") => {}
            _ => anyhow::bail!("Reviewer final response contains unfinished tool work"),
        }
    }
    ensure!(
        !text.trim().is_empty() && text.len() <= MAX_RESPONSE_BYTES,
        "Reviewer final response is empty or oversized"
    );
    Ok(text)
}

#[derive(Default)]
pub(crate) struct Stream {
    ready: bool,
    settled: bool,
    final_message: Value,
    calls: BTreeMap<String, Value>,
    reads: BTreeSet<String>,
}

impl Stream {
    fn scope(&mut self, event: &Value, root: &Path) -> Result<()> {
        ensure!(
            event["entry"]["data"]["root"] == json!(root),
            "Reviewer scope does not match the requested snapshot"
        );
        ensure!(
            event["entry"]["data"]["tools"] == json!(["read"]),
            "Reviewer did not activate the restricted reader"
        );
        self.ready = true;
        Ok(())
    }

    fn start_tool(&mut self, event: &Value) -> Result<()> {
        ensure!(self.ready, "Reviewer tool work preceded scope validation");
        let id = event["toolCallId"]
            .as_str()
            .context("Missing reviewer tool call ID")?;
        ensure!(
            self.calls.insert(id.to_owned(), event.clone()).is_none(),
            "Duplicate reviewer tool call ID"
        );
        Ok(())
    }

    fn end_tool(&mut self, event: &Value, root: &Path) -> Result<Option<String>> {
        let id = event["toolCallId"]
            .as_str()
            .context("Missing reviewer tool call ID")?;
        let call = self
            .calls
            .remove(id)
            .context("Reviewer tool result has no matching call")?;
        ensure!(
            event["isError"].is_boolean(),
            "Reviewer tool result has no outcome"
        );
        if event["isError"] == false {
            ensure!(
                call["toolName"] == "read" && event["toolName"] == "read",
                "Reviewer executed an unexpected tool"
            );
            let path = read_path(
                call["args"]["path"]
                    .as_str()
                    .context("Missing reviewer read path")?,
                root,
            )?;
            if self.reads.insert(path.clone()) {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }

    pub(crate) fn accept(&mut self, event: Value, root: &Path) -> Result<Option<String>> {
        ensure!(
            event.is_object() && event["type"].is_string(),
            "Malformed reviewer event stream"
        );
        if matches!(
            event["type"].as_str(),
            Some(
                "message_start"
                    | "message_update"
                    | "message_end"
                    | "tool_execution_start"
                    | "tool_execution_update"
                    | "tool_execution_end"
            )
        ) {
            self.settled = false;
        }
        match event["type"].as_str() {
            Some("entry_appended") if event["entry"]["customType"] == "review-scope-ready" => {
                self.scope(&event, root)?
            }
            Some("agent_start") => {
                self.settled = false;
                self.final_message = Value::Null;
            }
            Some("agent_settled") => self.settled = true,
            Some("message_end") if event["message"]["role"] == "assistant" => {
                self.final_message = event["message"].clone()
            }
            Some("tool_execution_start") => self.start_tool(&event)?,
            Some("tool_execution_end") => return self.end_tool(&event, root),
            _ => {}
        }
        Ok(None)
    }

    fn result(self, root: &Path) -> Result<Value> {
        ensure!(
            self.ready && self.settled && self.calls.is_empty(),
            "Reviewer scope or completion evidence is missing"
        );
        Ok(
            json!({"protocolVersion": 1, "snapshot": root, "response": final_text(&self.final_message)?, "filesRead": self.reads}),
        )
    }
}

pub fn validate(bytes: &[u8], root: &Path) -> Result<Value> {
    let mut stream = Stream::default();
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let event = serde_json::from_slice(line)
            .map_err(|_| anyhow::anyhow!("Malformed reviewer event stream"))?;
        stream.accept(event, root)?;
    }
    stream.result(root)
}
