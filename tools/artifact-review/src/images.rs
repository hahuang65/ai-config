use crate::paths::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::unix::fs::OpenOptionsExt,
    path::{Component, Path},
};

pub const MAX_IMAGES: usize = 24;
pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;

type Image = (&'static str, Vec<u8>);

fn mime(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

fn valid(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

fn embedded(source: &str) -> Result<Image> {
    let (header, encoded) = source
        .split_once(',')
        .ok_or("Unsupported embedded render. Approval is unavailable.")?;
    let mime = match header {
        "data:image/png;base64" => "image/png",
        "data:image/jpeg;base64" => "image/jpeg",
        "data:image/webp;base64" => "image/webp",
        "data:image/gif;base64" => "image/gif",
        _ => return Err("Unsupported embedded render. Approval is unavailable."),
    };
    if encoded.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
        return Err("Render exceeds the 2 MiB image limit. Approval is unavailable.");
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid embedded render. Approval is unavailable.")?;
    if !valid(mime, &bytes) {
        return Err("Invalid embedded render. Approval is unavailable.");
    }
    Ok((mime, bytes))
}

fn local(artifact: &Path, source: &str) -> Result<Image> {
    let relative = Path::new(source);
    if source.contains(['?', '#', '%'])
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err("Render path must stay beside the artifact. Approval is unavailable.");
    }
    let root = artifact.parent().ok_or("Cannot locate artifact renders.")?;
    let mut candidate = root.to_path_buf();
    for part in relative.components() {
        if let Component::Normal(name) = part {
            candidate.push(name);
            if fs::symlink_metadata(&candidate)
                .map_err(|_| "Cannot read local render. Approval is unavailable.")?
                .file_type()
                .is_symlink()
            {
                return Err("Render path contains a symlink. Approval is unavailable.");
            }
        }
    }
    let path = candidate
        .canonicalize()
        .map_err(|_| "Cannot resolve local render. Approval is unavailable.")?;
    if !path.starts_with(root) {
        return Err("Render escapes the artifact directory. Approval is unavailable.");
    }
    let mime = path
        .extension()
        .and_then(|part| part.to_str())
        .and_then(mime)
        .ok_or("Unsupported render format. Approval is unavailable.")?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&path)
        .map_err(|_| "Cannot open local render. Approval is unavailable.")?;
    let meta = file
        .metadata()
        .map_err(|_| "Cannot inspect local render. Approval is unavailable.")?;
    if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES as u64 {
        return Err("Render must be a regular file of at most 2 MiB. Approval is unavailable.");
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read local render. Approval is unavailable.")?;
    if bytes.len() > MAX_IMAGE_BYTES || !valid(mime, &bytes) {
        return Err("Invalid or oversized local render. Approval is unavailable.");
    }
    Ok((mime, bytes))
}

pub fn prepare(artifact: &Path, source: &str) -> Result<Option<Image>> {
    if source.starts_with("data:") {
        return embedded(source).map(Some);
    }
    // External resources are intentionally stripped; never fetch them or trust their contents.
    if source.is_empty() || source.starts_with('/') || source.contains(':') {
        return Ok(None);
    }
    local(artifact, source).map(Some)
}
