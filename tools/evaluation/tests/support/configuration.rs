#![allow(dead_code)]
use evaluation::configuration::{Link, Manifest, switch_configuration};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

pub const RECORD: &str = ".local/state/ai-config/installation.json";
pub const CLAUDE_SKILL: &str = ".claude/skills/selected";
pub const PI_SKILL: &str = ".pi/agent/skills/selected";
pub const OBSOLETE: &str = ".pi/agent/extensions/obsolete.ts";
pub const CLAUDE_SETTINGS: &str = ".claude/settings.json";
pub const PI_SETTINGS: &str = ".pi/agent/settings.json";

pub struct Fixture {
    _temporary: TempDir,
    pub base: PathBuf,
    pub home: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let base = temporary.path().canonicalize().unwrap();
        let home = base.join("home π ' space");
        fs::create_dir(&home).unwrap();
        Self {
            _temporary: temporary,
            base,
            home,
        }
    }

    pub fn source(&self, name: &str, obsolete: bool) -> Manifest {
        let source = self.base.join(name);
        put(
            source.join("skills/selected/SKILL.md"),
            "selected instructions",
        );
        let mut links = vec![
            Link {
                destination: CLAUDE_SKILL.into(),
                target: "skills/selected".into(),
            },
            Link {
                destination: PI_SKILL.into(),
                target: "skills/selected".into(),
            },
        ];
        if obsolete {
            put(source.join("extensions/obsolete.ts"), "fixture extension");
            links.push(Link {
                destination: OBSOLETE.into(),
                target: "extensions/obsolete.ts".into(),
            });
        }
        Manifest {
            version: 1,
            source,
            links,
            settings: Vec::new(),
        }
    }

    pub fn target(&self, destination: &str) -> PathBuf {
        fs::read_link(self.home.join(destination)).unwrap()
    }

    pub fn record(&self) -> Vec<u8> {
        fs::read(self.home.join(RECORD)).unwrap()
    }

    pub fn install(&self, manifest: &Manifest) {
        switch_configuration(&self.home, manifest).unwrap();
    }

    pub fn assert_source(&self, manifest: &Manifest) {
        for destination in [CLAUDE_SKILL, PI_SKILL] {
            assert_eq!(
                self.target(destination),
                manifest.source.join("skills/selected")
            );
        }
        assert_eq!(
            self.home.join(OBSOLETE).symlink_metadata().is_ok(),
            manifest
                .links
                .iter()
                .any(|link| link.destination == Path::new(OBSOLETE))
        );
        let record: Value = serde_json::from_slice(&self.record()).unwrap();
        assert_eq!(record["source"], manifest.source.to_str().unwrap());
    }
}

pub fn configured(source: Manifest, theme: &str, permission: &str) -> Manifest {
    with_settings(
        source,
        json!([
            {"destination": CLAUDE_SETTINGS, "path": ["theme"], "mode": "value", "value": theme},
            {"destination": CLAUDE_SETTINGS, "path": ["permissions", "allow"], "mode": "array_entry", "value": permission},
            {"destination": PI_SETTINGS, "path": ["theme"], "mode": "value", "value": theme}
        ]),
    )
}

pub fn with_settings(source: Manifest, settings: Value) -> Manifest {
    let mut manifest = serde_json::to_value(source).unwrap();
    manifest["version"] = json!(2);
    manifest["settings"] = settings;
    serde_json::from_value(manifest).unwrap()
}

pub fn settings(fixture: &Fixture, path: &str) -> Value {
    serde_json::from_slice(&fs::read(fixture.home.join(path)).unwrap()).unwrap()
}

pub fn put(path: impl AsRef<Path>, content: &str) {
    fs::create_dir_all(path.as_ref().parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}
