use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub type Failure = &'static str;
pub type Result<T> = std::result::Result<T, Failure>;
pub const MAX_ARTIFACT: u64 = evaluation::change::MAX_REPORT_BYTES as u64;

#[cfg(test)]
#[path = "../tests/support/size_limits.rs"]
mod tests;

#[derive(Clone)]
pub struct Paths {
    pub artifact: PathBuf,
    pub directory: PathBuf,
}

#[derive(Serialize, Deserialize)]
pub struct Descriptor {
    pub pid: u32,
    pub port: u16,
    pub capability: String,
}

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl Paths {
    pub fn resolve(file: &Path) -> Result<Self> {
        let parent = file
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let name = file.file_name().ok_or("Missing artifact filename.")?;
        let artifact = parent
            .canonicalize()
            .map_err(|_| "Cannot resolve artifact path.")?
            .join(name);
        let root = state_root()?;
        let directory = root.join(hash(artifact.as_os_str().as_encoded_bytes()));
        private_directory(&directory)?;
        Ok(Self {
            artifact,
            directory,
        })
    }

    pub fn read_artifact(&self) -> Result<String> {
        read_artifact(&self.artifact)
    }

    pub fn descriptor(&self) -> Result<Descriptor> {
        let source = fs::read(self.directory.join("server.json"))
            .map_err(|_| "Review is not running. Use open FILE first.")?;
        serde_json::from_slice(&source).map_err(|_| "Invalid private server record.")
    }

    pub fn save_descriptor(&self, descriptor: &Descriptor) -> Result<()> {
        let mut file = private_file(&self.directory.join("server.next"))?;
        file.set_len(0)
            .map_err(|_| "Cannot update private server record.")?;
        file.write_all(
            &serde_json::to_vec(descriptor).map_err(|_| "Cannot encode server record.")?,
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot save private server record.")?;
        fs::rename(
            self.directory.join("server.next"),
            self.directory.join("server.json"),
        )
        .map_err(|_| "Cannot publish private server record.")
    }
}

pub fn state_root() -> Result<PathBuf> {
    static DEFAULT: OnceLock<Result<PathBuf>> = OnceLock::new();
    let root = match std::env::var_os("AR_ROOT") {
        Some(root) => PathBuf::from(root),
        None => DEFAULT
            .get_or_init(|| {
                crate::review_state::default_root(
                    &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
                )
            })
            .clone()?,
    };
    private_directory(&root)?;
    root.canonicalize()
        .map_err(|_| "Cannot resolve review state directory.")
}

pub fn read_artifact(path: &Path) -> Result<String> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot read artifact.")?;
    if !file
        .metadata()
        .map_err(|_| "Cannot read artifact metadata.")?
        .is_file()
    {
        return Err("Artifact must remain a regular file.");
    }
    let mut source = String::new();
    file.take(MAX_ARTIFACT + 1)
        .read_to_string(&mut source)
        .map_err(|_| "Artifact must contain UTF-8 HTML.")?;
    if source.len() as u64 > MAX_ARTIFACT {
        return Err("Artifact exceeds the 25 MiB limit.");
    }
    Ok(source)
}

fn private_directory(path: &Path) -> Result<()> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|_| "Cannot create private session directory.")?;
    let metadata = fs::symlink_metadata(path).map_err(|_| "Cannot inspect session directory.")?;
    if !metadata.is_dir() || metadata.permissions().mode() & 0o077 != 0 {
        return Err("Session directory must be private (mode 0700), not a link.");
    }
    Ok(())
}

pub fn private_file(path: &Path) -> Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| "Cannot open private session file.")
}
