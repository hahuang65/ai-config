use crate::{diagram_process, paths::Result};
use clap::Args;
use serde_json::json;
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::PathBuf,
};

const MAX_SOURCE: u64 = 256 * 1024;

#[derive(Args)]
pub struct Arguments {
    /// UTF-8 file containing Pele-compatible Mermaid diagram or chart syntax.
    file: PathBuf,
    /// Available layout width in pixels (1 through 4096); omitted means natural size.
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=4096))]
    max_width: Option<u32>,
    /// Unique SVG ID prefix when embedding multiple diagrams in one artifact.
    #[arg(long)]
    id_prefix: Option<String>,
}

pub fn render(arguments: &Arguments) -> Result<()> {
    let file = arguments
        .file
        .canonicalize()
        .map_err(|_| "Cannot resolve diagram source. Provide a readable UTF-8 regular file.")?;
    let source = read_source(&file)?;
    let directory = file.parent().ok_or("Diagram source has no directory.")?;
    let mut options = serde_json::Map::new();
    if let Some(value) = arguments.max_width {
        options.insert("maxWidth".into(), json!(value));
    }
    if let Some(value) = &arguments.id_prefix {
        options.insert("idPrefix".into(), json!(value));
    }
    let request = json!({
        "engine": include_str!("../target/pele.mjs"),
        "source": source,
        "options": options,
    });
    let output = diagram_process::render(request.to_string().into_bytes(), directory)?;
    std::io::stdout()
        .lock()
        .write_all(&output)
        .map_err(|_| "Cannot write diagram SVG to stdout.")
}

fn read_source(path: &PathBuf) -> Result<String> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot open diagram source. Provide a readable UTF-8 regular file.")?;
    if !file
        .metadata()
        .map_err(|_| "Cannot inspect diagram source.")?
        .is_file()
    {
        return Err("Diagram source must be a regular file.");
    }
    let mut bytes = Vec::new();
    file.take(MAX_SOURCE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read diagram source.")?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_SOURCE {
        return Err("Diagram source must contain 1 through 262144 bytes.");
    }
    String::from_utf8(bytes).map_err(|_| "Diagram source must be UTF-8.")
}
