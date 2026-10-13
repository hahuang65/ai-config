//! Deterministic native-write interleavings at the planned-operation boundary.
use super::*;
use crate::configuration::{Mode, Setting};
use serde_json::json;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;
use tempfile::TempDir;

struct Fixture {
    _temporary: TempDir,
    home: PathBuf,
    manifest: Manifest,
    changes: Vec<Change>,
    original: String,
}

fn fields(value: &str) -> Vec<Setting> {
    [".claude/settings.json", ".pi/agent/settings.json"]
        .into_iter()
        .map(|destination| Setting {
            destination: destination.into(),
            path: vec!["theme".into()],
            mode: Mode::Value,
            value: json!(value),
        })
        .collect()
}

impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let home = temporary.path().canonicalize().unwrap();
        let original =
            "{\"theme\":\"before\", \"unknown\":[-0,0.12345678901234567890123456789,1e-9999]}\n"
                .to_owned();
        let previous = fields("before");
        let desired = fields("after");
        for setting in &previous {
            let path = home.join(&setting.destination);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, &original).unwrap();
        }
        symlink("before", home.join("link")).unwrap();
        fs::write(home.join("record"), "old record").unwrap();
        let mut changes = vec![Change::Link(crate::configuration::Change {
            destination: home.join("link"),
            before: Some("before".into()),
            after: Some("after".into()),
        })];
        changes.extend(
            settings_files::plan_with_links(&home, &previous, &desired, &Default::default())
                .unwrap()
                .into_iter()
                .map(Change::Settings),
        );
        let manifest = Manifest {
            version: 2,
            source: home.clone(),
            links: Vec::new(),
            settings: desired,
        };
        Self {
            _temporary: temporary,
            home,
            manifest,
            changes,
            original,
        }
    }

    fn with_linked_settings() -> Self {
        let mut fixture = Self::new();
        let destination = fixture.home.join(".claude/settings.json");
        let source = fixture.home.join("legacy-source.json");
        fs::rename(&destination, &source).unwrap();
        symlink(&source, &destination).unwrap();
        let linked = [(PathBuf::from(".claude/settings.json"), source)]
            .into_iter()
            .collect();
        fixture.changes.truncate(1);
        fixture.changes.extend(
            settings_files::plan_with_links(
                &fixture.home,
                &fields("before"),
                &fields("after"),
                &linked,
            )
            .unwrap()
            .into_iter()
            .map(Change::Settings),
        );
        fixture
    }

    fn contents(&self, path: &str) -> String {
        fs::read_to_string(self.home.join(path)).unwrap()
    }

    fn assert_link_and_record_restored(&self) {
        assert_eq!(
            fs::read_link(self.home.join("link")).unwrap(),
            PathBuf::from("before")
        );
        assert_eq!(self.contents("record"), "old record");
    }
}

#[test]
fn refuses_a_legacy_source_edit_after_preflight_without_detaching_the_link() {
    let fixture = Fixture::with_linked_settings();
    let changed = r#"{"theme":"before","personal":"new-source-value"}"#;
    fs::write(fixture.home.join("legacy-source.json"), changed).unwrap();
    assert!(
        apply(
            &fixture.changes,
            &fixture.home.join("record"),
            &fixture.manifest
        )
        .is_err()
    );
    fixture.assert_link_and_record_restored();
    assert_eq!(
        fs::read_link(fixture.home.join(".claude/settings.json")).unwrap(),
        fixture.home.join("legacy-source.json")
    );
    assert_eq!(fixture.contents("legacy-source.json"), changed);
    assert_eq!(
        fixture.contents(".pi/agent/settings.json"),
        fixture.original
    );
}

#[test]
fn restores_the_legacy_symlink_without_overwriting_a_source_edit_during_rollback() {
    let fixture = Fixture::with_linked_settings();
    for change in &fixture.changes {
        change.apply(false).unwrap();
    }
    let changed = r#"{"theme":"before","personal":"new-source-value"}"#;
    fs::write(fixture.home.join("legacy-source.json"), changed).unwrap();
    let failure = fs::write(fixture.home.join("missing/record"), "new record").map_err(Into::into);
    let error = finish(failure, fixture.changes.iter().collect()).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("prior links and settings restored")
    );
    fixture.assert_link_and_record_restored();
    assert_eq!(
        fs::read_link(fixture.home.join(".claude/settings.json")).unwrap(),
        fixture.home.join("legacy-source.json")
    );
    assert_eq!(fixture.contents("legacy-source.json"), changed);
    assert_eq!(
        fixture.contents(".pi/agent/settings.json"),
        fixture.original
    );
}

#[test]
fn refuses_a_native_edit_after_preflight_and_restores_completed_changes() {
    let fixture = Fixture::new();
    let concurrent = r#"{"theme":"before","defaultModel":"native-choice"}"#;
    fs::write(fixture.home.join(".pi/agent/settings.json"), concurrent).unwrap();
    let outcome = apply(
        &fixture.changes,
        &fixture.home.join("record"),
        &fixture.manifest,
    );
    assert!(outcome.is_err());
    fixture.assert_link_and_record_restored();
    assert_eq!(fixture.contents(".claude/settings.json"), fixture.original);
    assert_eq!(fixture.contents(".pi/agent/settings.json"), concurrent);
}

#[test]
fn preserves_native_edits_and_reports_incomplete_rollback_while_restoring_other_resources() {
    let fixture = Fixture::new();
    for change in &fixture.changes {
        change.apply(false).unwrap();
    }
    let concurrent = r#"{"theme":"after","personal":"native-edit"}"#;
    fs::write(fixture.home.join(".claude/settings.json"), concurrent).unwrap();
    let write_failure =
        fs::write(fixture.home.join("missing/record"), "new record").map_err(Into::into);
    let error = finish(write_failure, fixture.changes.iter().collect()).unwrap_err();
    assert!(error.to_string().contains("rollback incomplete"));
    assert!(!format!("{error:#}").contains("native-edit"));
    fixture.assert_link_and_record_restored();
    assert_eq!(fixture.contents(".claude/settings.json"), concurrent);
    assert_eq!(
        fixture.contents(".pi/agent/settings.json"),
        fixture.original
    );
}
