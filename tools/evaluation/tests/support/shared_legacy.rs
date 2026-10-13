#![allow(dead_code)]
#[path = "captured_installers.rs"]
pub(super) mod captures;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

pub struct SharedLegacyFixture {
    _temporary: TempDir,
    pub source: PathBuf,
    pub home: PathBuf,
    pub upstream: PathBuf,
    pub agentmemory: PathBuf,
    bin: PathBuf,
}

fn put(path: &Path, contents: impl AsRef<[u8]>) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn source_files(source: &Path) {
    for relative in [
        "install.sh",
        "harnesses/claude/manifest.sh",
        "harnesses/claude/settings.json",
        "harnesses/pi/manifest.sh",
        "harnesses/pi/settings.json",
    ] {
        let destination = source.join(relative);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(
            destination,
            captures::read(&format!("legacy-shared/{relative}")),
        )
        .unwrap();
    }
    let tree: Value =
        serde_json::from_slice(&captures::read("legacy-shared/source-tree.json")).unwrap();
    for category in ["skills", "agents", "commands"] {
        for name in tree[category].as_array().unwrap() {
            let path = source.join(category).join(name.as_str().unwrap());
            let path = if category == "skills" {
                path.join("fixture.md")
            } else {
                path
            };
            put(&path, "fixture resource; never executed\n");
        }
    }
    put(&source.join("baseline-prompt.md"), "fixture bootstrap\n");
    put(&source.join("rules/testing.md"), "fixture rule\n");
    for service in ["agentmemory", "review-publication"] {
        put(
            &source.join(service).join("install.sh"),
            format!(
                "#!/bin/sh\nprintf '%s\\n' '{service}' >> \"$AI_CONFIG_REPO_DIR/service-calls\"\n"
            ),
        );
    }
}

impl SharedLegacyFixture {
    pub fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let base = temporary.path().canonicalize().unwrap();
        let source = base.join("legacy π ' source");
        let home = base.join("home π ' space");
        fs::create_dir_all(&home).unwrap();
        source_files(&source);
        let upstream = base.join("homebrew/opt/pi-coding-agent/libexec/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent");
        put(
            &upstream.join("index.ts"),
            "fixture upstream; never executed\n",
        );
        let bin = base.join("homebrew/bin");
        put(&bin.join("pi"), "#!/bin/sh\nexit 91\n");
        fs::set_permissions(bin.join("pi"), fs::Permissions::from_mode(0o755)).unwrap();
        let agentmemory = base.join("mise/agentmemory/bin/agentmemory");
        let initialized = Command::new("git")
            .env_clear()
            .env("HOME", &home)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .args([
                "init",
                "--quiet",
                "--template=",
                "--initial-branch=hh/fixture",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            initialized.status.success(),
            "{}",
            String::from_utf8_lossy(&initialized.stderr)
        );
        Self {
            _temporary: temporary,
            source,
            home,
            upstream,
            agentmemory,
            bin,
        }
    }

    pub fn install_projection(&self) {
        let output = Command::new("/bin/bash")
            .env_clear()
            .env("HOME", &self.home)
            .env("PATH", format!("{}:/usr/bin:/bin", self.bin.display()))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .args(["--noprofile", "--norc"])
            .arg(self.source.join("install.sh"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}\n{}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            fs::read_to_string(self.source.join("service-calls")).unwrap(),
            "review-publication\nagentmemory\n"
        );
    }

    pub fn links(&self) -> BTreeMap<PathBuf, PathBuf> {
        let mut links = BTreeMap::new();
        collect_links(&self.home, &self.home, &mut links);
        links
    }
}

fn collect_links(home: &Path, directory: &Path, links: &mut BTreeMap<PathBuf, PathBuf>) {
    for entry in fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        let metadata = fs::symlink_metadata(&path).unwrap();
        if metadata.is_symlink() {
            links.insert(
                path.strip_prefix(home).unwrap().to_owned(),
                fs::read_link(path).unwrap(),
            );
        } else if metadata.is_dir() {
            collect_links(home, &path, links);
        }
    }
}
