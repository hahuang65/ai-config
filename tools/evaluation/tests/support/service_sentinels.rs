use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};

pub struct Sentinels {
    files: Vec<(PathBuf, Vec<u8>)>,
    links: Vec<(PathBuf, PathBuf)>,
}

impl Sentinels {
    pub fn new(home: &Path, source: &Path) -> Self {
        Self {
            files: seed_files(home),
            links: seed_links(home, source),
        }
    }

    pub fn assert_unchanged(&self) {
        for (path, bytes) in &self.files {
            assert_eq!(fs::read(path).unwrap(), *bytes);
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o640
            );
            assert!(fs::symlink_metadata(path).unwrap().is_file());
        }
        for (path, target) in &self.links {
            assert_eq!(fs::read_link(path).unwrap().as_os_str(), target.as_os_str());
        }
    }
}

fn seed_files(home: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    [
        "Library/LaunchAgents/dev.agentmemory.plist",
        "Library/LaunchAgents/dev.review-publication.plist",
        ".local/bin/review-publication",
        ".review-publication/worker-config.json",
        ".review-publication/review-publication-worker.mjs",
        ".review-publication/history.json",
        ".config/systemd/user/review-publication.socket",
        ".config/systemd/user/review-publication@.service",
        "Library/Application Support/agentmemory/state_store.db",
        ".local/share/agentmemory/state_store.db",
        "data/state_store.db",
    ]
    .into_iter()
    .map(|path| {
        let destination = home.join(path);
        let bytes = format!("private fixture for {path}\n").into_bytes();
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(&destination, &bytes).unwrap();
        fs::set_permissions(&destination, fs::Permissions::from_mode(0o640)).unwrap();
        (destination, bytes)
    })
    .collect()
}

fn seed_links(home: &Path, source: &Path) -> Vec<(PathBuf, PathBuf)> {
    [
        (
            ".agentmemory/iii-config.yaml",
            source.join("agentmemory/iii-config.yaml"),
        ),
        (
            ".config/systemd/user/agentmemory.service",
            source.join("agentmemory/agentmemory.service"),
        ),
        (
            ".agentmemory/service-install-state",
            PathBuf::from("fixture-fingerprint"),
        ),
    ]
    .into_iter()
    .map(|(path, target)| {
        let destination = home.join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        symlink(&target, &destination).unwrap();
        (destination, target)
    })
    .collect()
}
