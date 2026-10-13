#![allow(dead_code)]
use super::fixture::{
    CLAUDE_SETTINGS as CLAUDE, Fixture, PI_SETTINGS as PI, RECORD, configured, put,
};
use evaluation::configuration::{LegacyInstallation, LegacyLink, Manifest, adopt_configuration};
use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;

pub const ORIGINAL: &str = r#"{"theme":"old-theme","model":"saved-model","permissions":{"allow":["Read(old/**)","Read(personal/**)"]}}"#;
pub const PI_ORIGINAL: &str = r#"{"theme":"old-theme","defaultModel":"saved-model"}"#;

pub struct LegacyFixture {
    pub fixture: Fixture,
    pub old: Manifest,
    pub next: Manifest,
    pub legacy: LegacyInstallation,
    pub source_settings: PathBuf,
}

impl LegacyFixture {
    pub fn new() -> Self {
        let fixture = Fixture::new();
        let old = configured(fixture.source("legacy", true), "old-theme", "Read(old/**)");
        let next = configured(fixture.source("next", false), "new-theme", "Read(new/**)");
        let source_settings = old.source.join("harnesses/claude/settings.json");
        put(&source_settings, ORIGINAL);
        let links = old
            .links
            .iter()
            .map(|link| LegacyLink {
                destination: link.destination.clone(),
                target: old.source.join(&link.target),
            })
            .collect::<Vec<_>>();
        for link in &links {
            let destination = fixture.home.join(&link.destination);
            fs::create_dir_all(destination.parent().unwrap()).unwrap();
            symlink(&link.target, destination).unwrap();
        }
        symlink(&source_settings, fixture.home.join(CLAUDE)).unwrap();
        put(fixture.home.join(PI), PI_ORIGINAL);
        let legacy = LegacyInstallation {
            source: old.source.clone(),
            links,
            settings: old.settings.clone(),
            settings_links: vec![LegacyLink {
                destination: CLAUDE.into(),
                target: source_settings.clone(),
            }],
        };
        Self {
            fixture,
            old,
            next,
            legacy,
            source_settings,
        }
    }

    pub fn adopt(&self) -> anyhow::Result<()> {
        adopt_configuration(&self.fixture.home, &self.next, &self.legacy)
    }

    pub fn assert_legacy_links(&self) {
        for link in &self.legacy.links {
            assert_eq!(
                self.fixture
                    .target(link.destination.to_str().unwrap())
                    .as_os_str(),
                link.target.as_os_str()
            );
        }
    }

    pub fn assert_original(&self) {
        self.assert_legacy_links();
        assert_eq!(
            fs::read_link(self.fixture.home.join(CLAUDE))
                .unwrap()
                .as_os_str(),
            self.source_settings.as_os_str()
        );
        assert_eq!(fs::read_to_string(&self.source_settings).unwrap(), ORIGINAL);
        assert_eq!(
            fs::read_to_string(self.fixture.home.join(PI)).unwrap(),
            PI_ORIGINAL
        );
        assert!(self.fixture.home.join(RECORD).symlink_metadata().is_err());
    }
}
