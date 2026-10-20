use crate::{
    change_types::{MAX_REPORT_BYTES, Report},
    paths::Paths,
};
use anyhow::{Context, Result, ensure};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, DirBuilder, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

pub struct Store {
    pub root: PathBuf,
}

fn directories(path: &Path) -> Result<()> {
    for ancestor in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) => ensure!(
                meta.is_dir(),
                "State path contains a symlink or non-directory"
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                DirBuilder::new().mode(0o700).create(ancestor)?
            }
            Err(error) => return Err(error.into()),
        }
    }
    let meta = fs::metadata(path)?;
    ensure!(
        meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o077 == 0,
        "State directory must be owned by this user and private (mode 700)"
    );
    Ok(())
}

pub fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::File::open(path.parent().context("Missing parent directory")?)?.sync_all()?;
    Ok(())
}

pub fn read(path: &Path, maximum: usize) -> Result<Vec<u8>> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let meta = file.metadata()?;
    ensure!(
        meta.is_file()
            && meta.uid() == unsafe { libc::geteuid() }
            && meta.mode() & 0o077 == 0
            && meta.len() <= maximum as u64,
        "Retained review file is not private, regular, or bounded"
    );
    let mut bytes = vec![];
    (&mut file)
        .take((maximum + 1) as u64)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= maximum,
        "Retained review file exceeds its limit"
    );
    Ok(bytes)
}

impl Store {
    pub fn open(paths: &Paths, selected: Option<&Path>) -> Result<Self> {
        let root = selected
            .map(Path::to_owned)
            .unwrap_or_else(|| paths.state.join("change-reviews"));
        ensure!(
            root.is_absolute() && root.is_dir(),
            "Review store does not exist"
        );
        directories(&root)?;
        let expected =
            serde_json::to_vec(&serde_json::json!({"version":1,"evaluation":paths.root}))?;
        ensure!(
            read(&root.join("owner.json"), 8192)? == expected,
            "Review state belongs to a different evaluation"
        );
        Ok(Self {
            root: root.canonicalize()?,
        })
    }

    pub fn save_object<T: serde::Serialize>(
        &self,
        directory: &Path,
        name: &str,
        object: &T,
    ) -> Result<()> {
        write(
            &directory.join(name),
            &self.object_bytes(directory, name, object)?,
        )
    }

    fn object_bytes<T: serde::Serialize>(
        &self,
        directory: &Path,
        name: &str,
        object: &T,
    ) -> Result<Vec<u8>> {
        let payload = serde_json::to_string(object)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key()?)?;
        mac.update(directory.file_name().unwrap().as_encoded_bytes());
        mac.update(name.as_bytes());
        mac.update(payload.as_bytes());
        let signature: Vec<u8> = mac.finalize().into_bytes().to_vec();
        Ok(serde_json::to_vec(
            &serde_json::json!({"payload":payload,"signature":signature}),
        )?)
    }

    pub fn load_object<T: serde::de::DeserializeOwned>(
        &self,
        directory: &Path,
        name: &str,
    ) -> Result<T> {
        self.load_object_bounded(directory, name, 2 * 1024 * 1024)
    }

    pub(crate) fn load_object_bounded<T: serde::de::DeserializeOwned>(
        &self,
        directory: &Path,
        name: &str,
        maximum: usize,
    ) -> Result<T> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Envelope {
            payload: String,
            signature: Vec<u8>,
        }
        let envelope: Envelope = serde_json::from_slice(&read(&directory.join(name), maximum)?)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&read(&self.root.join("signing-key"), 32)?)?;
        mac.update(directory.file_name().unwrap().as_encoded_bytes());
        mac.update(name.as_bytes());
        mac.update(envelope.payload.as_bytes());
        mac.verify_slice(&envelope.signature).map_err(|_| {
            anyhow::anyhow!("Posting state was changed; no new submission is allowed")
        })?;
        Ok(serde_json::from_str(&envelope.payload)?)
    }

    pub fn new(paths: &Paths, selected: Option<&Path>, repository: Option<&Path>) -> Result<Self> {
        let root = selected
            .map(Path::to_owned)
            .unwrap_or_else(|| paths.state.join("change-reviews"));
        ensure!(
            root.is_absolute()
                && !root
                    .components()
                    .any(|p| matches!(p, std::path::Component::ParentDir)),
            "State directory must be absolute without parent components"
        );
        if let Some(repo) = repository {
            ensure!(
                !root.starts_with(repo) && !repo.starts_with(&root),
                "Use --state-dir outside the reviewed checkout"
            );
        }
        directories(&root)?;
        let owner = root.join("owner.json");
        let expected =
            serde_json::to_vec(&serde_json::json!({"version":1,"evaluation":paths.root}))?;
        if !owner.try_exists()? {
            match write(&owner, &expected) {
                Ok(()) => {}
                Err(error)
                    if error
                        .downcast_ref::<std::io::Error>()
                        .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists) => {}
                Err(error) => return Err(error),
            }
        }
        ensure!(
            read(&owner, 8192)? == expected,
            "Review state belongs to a different evaluation"
        );
        Ok(Self {
            root: root.canonicalize()?,
        })
    }

    fn key(&self) -> Result<Vec<u8>> {
        let path = self.root.join("signing-key");
        if !path.try_exists()? {
            match write(&path, &rand::random::<[u8; 32]>()) {
                Ok(()) => {}
                Err(error)
                    if error
                        .downcast_ref::<std::io::Error>()
                        .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists) => {}
                Err(error) => return Err(error),
            }
        }
        let bytes = read(&path, 32)?;
        ensure!(bytes.len() == 32, "Invalid review signing key");
        Ok(bytes)
    }

    pub fn save(&self, directory: &Path, report: &Report, html: &str) -> Result<()> {
        let bytes = serde_json::to_vec(report)?;
        ensure!(
            bytes.len() <= MAX_REPORT_BYTES && html.len() <= MAX_REPORT_BYTES,
            "Retained report exceeds 25 MiB"
        );
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key()?)?;
        mac.update(
            directory
                .file_name()
                .context("Missing review identifier")?
                .as_encoded_bytes(),
        );
        mac.update(&bytes);
        write(&directory.join("report.json"), &bytes)?;
        write(&directory.join("report.mac"), &mac.finalize().into_bytes())?;
        write(&directory.join("report.html"), html.as_bytes())
    }

    pub(crate) fn replace_object<T: serde::Serialize>(
        &self,
        directory: &Path,
        name: &str,
        object: &T,
    ) -> Result<()> {
        crate::change_update::atomic(
            &directory.join(name),
            &self.object_bytes(directory, name, object)?,
        )
    }

    pub(crate) fn replace_report(
        &self,
        directory: &Path,
        report: &Report,
        html: &str,
    ) -> Result<()> {
        let bytes = serde_json::to_vec(report)?;
        ensure!(
            bytes.len() <= MAX_REPORT_BYTES && html.len() <= MAX_REPORT_BYTES,
            "Report update exceeds its limit"
        );
        ensure!(
            report.version == 1 && format!("{:x}", Sha256::digest(html)) == report.html_digest,
            "Invalid current report bytes"
        );
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key()?)?;
        mac.update(
            directory
                .file_name()
                .context("Missing report directory")?
                .as_encoded_bytes(),
        );
        mac.update(&bytes);
        crate::change_update::atomic(&directory.join("report.json"), &bytes)?;
        crate::change_update::atomic(&directory.join("report.mac"), &mac.finalize().into_bytes())?;
        crate::change_update::atomic(&directory.join("report.html"), html.as_bytes())
    }

    pub fn load(&self, selected: &Path) -> Result<(PathBuf, Report)> {
        ensure!(
            matches!(
                selected.file_name().and_then(|n| n.to_str()),
                Some("report.html" | "report.json")
            ),
            "Select a retained report.html or report.json"
        );
        let directory = selected
            .parent()
            .context("Report has no parent")?
            .canonicalize()?;
        ensure!(
            directory.parent() == Some(self.root.as_path()),
            "Report is outside the selected review store"
        );
        let bytes = read(&directory.join("report.json"), MAX_REPORT_BYTES)?;
        let signature = read(&directory.join("report.mac"), 32)?;
        let mut mac = Hmac::<Sha256>::new_from_slice(&read(&self.root.join("signing-key"), 32)?)?;
        mac.update(directory.file_name().unwrap().as_encoded_bytes());
        mac.update(&bytes);
        mac.verify_slice(&signature)
            .map_err(|_| anyhow::anyhow!("Retained report was changed; run a fresh review"))?;
        let report: Report = serde_json::from_slice(&bytes).context("Invalid retained report")?;
        ensure!(report.version == 1, "Unsupported retained report version");
        let html = read(&directory.join("report.html"), MAX_REPORT_BYTES)?;
        ensure!(
            format!("{:x}", Sha256::digest(html)) == report.html_digest,
            "HTML report changed; run a fresh review before posting"
        );
        Ok((directory, report))
    }
}
