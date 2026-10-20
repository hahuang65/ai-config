use crate::change_store;
use anyhow::{Result, ensure};
use sha2::{Digest, Sha256};
use std::{fs, os::unix::fs::DirBuilderExt, path::Path};

struct Capture {
    hash: Sha256,
    bytes: usize,
    files: usize,
}

pub(crate) fn capture(source: &Path, destination: Option<&Path>) -> Result<String> {
    let mut capture = Capture {
        hash: Sha256::new(),
        bytes: 0,
        files: 0,
    };
    for name in ["before", "after", "scope.json", "patch.diff"] {
        capture.visit(source, Path::new(name), destination, 0)?;
    }
    Ok(format!("{:x}", capture.hash.finalize()))
}

impl Capture {
    fn visit(
        &mut self,
        root: &Path,
        relative: &Path,
        destination: Option<&Path>,
        depth: usize,
    ) -> Result<()> {
        self.files += 1;
        ensure!(
            depth <= 64 && self.files <= 20_000,
            "Retained snapshot exceeds feedback limits"
        );
        let path = root.join(relative);
        let metadata = fs::symlink_metadata(&path)?;
        ensure!(
            !metadata.is_symlink(),
            "Retained snapshot contains a symlink"
        );
        if metadata.is_dir() {
            return self.directory(root, relative, destination, depth);
        }
        let bytes = change_store::read(&path, 16 * 1024 * 1024)?;
        self.bytes += bytes.len();
        ensure!(
            self.bytes <= 128 * 1024 * 1024,
            "Retained snapshot exceeds 128 MiB"
        );
        let name = relative.as_os_str().as_encoded_bytes();
        self.hash.update((name.len() as u64).to_be_bytes());
        self.hash.update(name);
        self.hash.update((bytes.len() as u64).to_be_bytes());
        self.hash.update(&bytes);
        if let Some(destination) = destination {
            change_store::write(&destination.join(relative), &bytes)?;
        }
        Ok(())
    }

    fn directory(
        &mut self,
        root: &Path,
        relative: &Path,
        destination: Option<&Path>,
        depth: usize,
    ) -> Result<()> {
        if let Some(destination) = destination {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(destination.join(relative))?;
        }
        let mut entries = fs::read_dir(root.join(relative))?
            .take(20_001)
            .collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        ensure!(
            entries.len() <= 20_000,
            "Retained snapshot has too many entries"
        );
        for entry in entries {
            self.visit(
                root,
                &relative.join(entry.file_name()),
                destination,
                depth + 1,
            )?;
        }
        Ok(())
    }
}
