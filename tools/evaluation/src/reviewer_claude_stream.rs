//! Validate Claude's native restricted-review JSONL independently of Pi events.
use crate::reviewer_stream::{MAX_RESPONSE_BYTES, read_path};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Default)]
struct Stream {
    session: Option<String>,
    settled: bool,
    calls: BTreeMap<String, String>,
    reads: BTreeSet<String>,
    last_text: Option<String>,
    response: Option<String>,
}

impl Stream {
    fn session(&self, event: &Value) -> Result<()> {
        ensure!(
            event["session_id"].as_str() == self.session.as_deref(),
            "Claude reviewer session identity changed"
        );
        Ok(())
    }

    fn init(&mut self, event: &Value, root: &Path) -> Result<()> {
        ensure!(
            self.session.is_none(),
            "Repeated Claude reviewer initialization"
        );
        ensure!(
            event["cwd"] == json!(root)
                && event["tools"] == json!(["Read"])
                && event["mcp_servers"] == json!([])
                && event["permissionMode"] == "dontAsk",
            "Claude reviewer did not activate the isolated reader"
        );
        let session = event["session_id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .context("Claude reviewer has no session identity")?;
        self.session = Some(session.to_owned());
        Ok(())
    }

    fn assistant(&mut self, event: &Value) -> Result<()> {
        let blocks = event["message"]["content"]
            .as_array()
            .context("Malformed Claude reviewer assistant event")?;
        let mut text = String::new();
        let mut has_tool = false;
        for block in blocks {
            match block["type"].as_str() {
                Some("tool_use") => {
                    has_tool = true;
                    ensure!(
                        block["name"] == "Read",
                        "Claude reviewer attempted an unexpected tool"
                    );
                    let id = block["id"]
                        .as_str()
                        .filter(|id| !id.is_empty())
                        .context("Claude reviewer read has no ID")?;
                    let path = block["input"]["file_path"]
                        .as_str()
                        .context("Claude reviewer read has no file path")?;
                    ensure!(
                        self.calls.insert(id.into(), path.into()).is_none(),
                        "Duplicate Claude reviewer read ID"
                    );
                }
                Some("text") => text.push_str(
                    block["text"]
                        .as_str()
                        .context("Malformed Claude reviewer response text")?,
                ),
                Some("thinking") => {}
                _ => anyhow::bail!("Claude reviewer emitted unsupported assistant content"),
            }
        }
        if !has_tool {
            self.last_text = Some(text);
        }
        Ok(())
    }

    fn user(&mut self, event: &Value, root: &Path) -> Result<()> {
        let blocks = event["message"]["content"]
            .as_array()
            .context("Malformed Claude reviewer tool result")?;
        ensure!(!blocks.is_empty(), "Claude reviewer tool result is empty");
        ensure!(
            blocks.len() == 1,
            "Claude reviewer tool results are not individually verified"
        );
        self.last_text = None;
        for block in blocks {
            ensure!(
                block["type"] == "tool_result",
                "Unexpected Claude reviewer user content"
            );
            let id = block["tool_use_id"]
                .as_str()
                .context("Claude tool result has no call ID")?;
            let path = self
                .calls
                .remove(id)
                .context("Claude tool result has no matching read")?;
            ensure!(
                block["is_error"].is_null() || block["is_error"].is_boolean(),
                "Claude tool result has no valid outcome"
            );
            if block["is_error"] == true {
                continue;
            }
            let relative = read_path(&path, root)?;
            ensure!(
                block["content"]
                    .as_str()
                    .is_some_and(|text| !text.is_empty())
                    && event["tool_use_result"]["type"] == "text"
                    && (event["tool_use_result"]["file"]["filePath"] == path
                        || event["tool_use_result"]["file"]["filePath"]
                            == json!(root.join(&relative))),
                "Claude reviewer read lacks matching successful file evidence"
            );
            self.reads.insert(relative);
        }
        Ok(())
    }

    fn finish(&mut self, event: &Value) -> Result<()> {
        ensure!(
            self.calls.is_empty(),
            "Claude reviewer has unfinished read work"
        );
        ensure!(
            event["subtype"] == "success"
                && event["is_error"] == false
                && event["stop_reason"] == "end_turn",
            "Claude reviewer did not finish successfully"
        );
        let response = event["result"]
            .as_str()
            .context("Claude reviewer result is missing")?;
        ensure!(
            !response.trim().is_empty()
                && response.len() <= MAX_RESPONSE_BYTES
                && self.last_text.as_deref() == Some(response),
            "Claude reviewer response is empty, oversized, or does not match its final message"
        );
        self.response = Some(response.into());
        self.settled = true;
        Ok(())
    }

    fn accept(&mut self, event: Value, root: &Path) -> Result<()> {
        ensure!(
            !self.settled,
            "Claude reviewer emitted data after completion"
        );
        match (event["type"].as_str(), event["subtype"].as_str()) {
            (Some("system"), Some("init")) => self.init(&event, root),
            (Some("system"), _) => Ok(()),
            (Some("assistant" | "user" | "result"), _) => {
                ensure!(
                    self.session.is_some(),
                    "Claude reviewer work preceded initialization"
                );
                self.session(&event)?;
                match event["type"].as_str() {
                    Some("assistant") => self.assistant(&event),
                    Some("user") => self.user(&event, root),
                    _ => self.finish(&event),
                }
            }
            _ => anyhow::bail!("Malformed Claude reviewer event stream"),
        }
    }
}

pub fn validate(bytes: &[u8], root: &Path) -> Result<Value> {
    let mut stream = Stream::default();
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let event: Value = serde_json::from_slice(line)
            .map_err(|_| anyhow::anyhow!("Malformed Claude reviewer event stream"))?;
        stream.accept(event, root)?;
    }
    let response = stream
        .response
        .context("Claude reviewer has no completed result")?;
    ensure!(
        !stream.reads.is_empty(),
        "Claude reviewer did not read snapshot evidence"
    );
    Ok(json!({"protocolVersion":1,"snapshot":root,"response":response,"filesRead":stream.reads}))
}
