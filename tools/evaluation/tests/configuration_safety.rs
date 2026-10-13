#[path = "support/configuration.rs"]
mod fixture;
use evaluation::configuration::switch_configuration as switch_links;
use fixture::{CLAUDE_SKILL, Fixture, OBSOLETE, PI_SKILL, RECORD, put};
use std::fs;
use std::os::unix::fs::symlink;

#[test]
fn rejects_a_source_that_contains_its_own_installation_destinations() {
    let fixture = Fixture::new();
    let source = fixture.source("home π ' space/source", false);
    fixture.install(&source);
    let before = fixture.record();
    let mut cyclic = source.clone();
    cyclic.source = fixture.home.clone();
    cyclic.links[0].target = PI_SKILL.into();
    cyclic.links[1].target = CLAUDE_SKILL.into();
    assert!(switch_links(&fixture.home, &cyclic).is_err());
    fixture.assert_source(&source);
    assert_eq!(fixture.record(), before);
}

#[test]
fn rejects_a_selected_source_that_contains_obsolete_owned_resources() {
    let fixture = Fixture::new();
    let source = fixture.source("source", true);
    fixture.install(&source);
    let before = fixture.record();
    let mut nested = source.clone();
    nested.source = fixture.home.join(".pi/agent/extensions");
    nested.links.clear();
    assert!(switch_links(&fixture.home, &nested).is_err());
    fixture.assert_source(&source);
    assert_eq!(fixture.record(), before);
}

#[test]
fn protects_the_selected_source_from_settings_only_recorded_destinations() {
    let fixture = Fixture::new();
    let mut source = fixture.source("source", false);
    source.links.clear();
    let source = fixture::with_settings(
        source,
        serde_json::json!([
            {"destination":fixture::PI_SETTINGS,"path":["theme"],"mode":"value","value":"saved-theme"}
        ]),
    );
    fixture.install(&source);
    let record = fixture.record();
    let before = std::fs::read(fixture.home.join(fixture::PI_SETTINGS)).unwrap();
    let mut nested = source.clone();
    nested.source = fixture.home.join(".pi/agent");
    nested.settings.clear();
    assert!(switch_links(&fixture.home, &nested).is_err());
    assert_eq!(fixture.record(), record);
    assert_eq!(
        std::fs::read(fixture.home.join(fixture::PI_SETTINGS)).unwrap(),
        before
    );
}

#[test]
fn detects_a_foreign_file_before_changing_either_harness() {
    let fixture = Fixture::new();
    let shared = fixture.source("shared", true);
    let minimal = fixture.source("minimal", false);
    fixture.install(&shared);
    let before = fixture.record();
    fs::remove_file(fixture.home.join(PI_SKILL)).unwrap();
    put(fixture.home.join(PI_SKILL), "user-owned replacement");
    assert!(switch_links(&fixture.home, &minimal).is_err());
    assert_eq!(
        fixture.target(CLAUDE_SKILL),
        shared.source.join("skills/selected")
    );
    assert_eq!(
        fs::read_to_string(fixture.home.join(PI_SKILL)).unwrap(),
        "user-owned replacement"
    );
    assert_eq!(fixture.record(), before);
}

#[test]
fn refuses_unrecorded_links_even_if_dangling_or_pointing_to_the_selected_source() {
    for existing in ["dangling", "source"] {
        let fixture = Fixture::new();
        let source = fixture.source("source", false);
        let target = if existing == "source" {
            source.source.join("skills/selected")
        } else {
            fixture.base.join("missing")
        };
        let link = fixture.home.join(PI_SKILL);
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink(&target, &link).unwrap();
        assert!(switch_links(&fixture.home, &source).is_err());
        assert_eq!(fs::read_link(link).unwrap(), target);
        assert!(fixture.home.join(CLAUDE_SKILL).symlink_metadata().is_err());
        assert!(!fixture.home.join(RECORD).exists());
    }
}

#[test]
fn preserves_a_modified_obsolete_link_instead_of_pruning_it() {
    let fixture = Fixture::new();
    let shared = fixture.source("shared", true);
    let minimal = fixture.source("minimal", false);
    fixture.install(&shared);
    let target = fixture.base.join("foreign");
    fs::remove_file(fixture.home.join(OBSOLETE)).unwrap();
    symlink(&target, fixture.home.join(OBSOLETE)).unwrap();
    assert!(switch_links(&fixture.home, &minimal).is_err());
    fixture.assert_source(&shared);
    assert_eq!(fixture.target(OBSOLETE), target);
}

#[test]
fn refuses_a_redirected_harness_parent_without_writing_outside_home() {
    let fixture = Fixture::new();
    let source = fixture.source("source", false);
    let outside = fixture.base.join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, fixture.home.join(".pi")).unwrap();
    assert!(switch_links(&fixture.home, &source).is_err());
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
    assert!(fixture.home.join(CLAUDE_SKILL).symlink_metadata().is_err());
}

#[test]
fn refuses_redirected_state_and_record_and_lock_paths() {
    for relative in [
        ".local/state/ai-config",
        RECORD,
        ".local/state/ai-config/install.lock",
    ] {
        let fixture = Fixture::new();
        let source = fixture.source("source", false);
        let outside = fixture.base.join("outside");
        fs::create_dir(&outside).unwrap();
        let link = fixture.home.join(relative);
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink(&outside, link).unwrap();
        assert!(switch_links(&fixture.home, &source).is_err());
        assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
        assert!(fixture.home.join(CLAUDE_SKILL).symlink_metadata().is_err());
    }
}

#[test]
fn rejects_links_to_missing_sources_or_resources_outside_the_selected_source() {
    for escape in [false, true] {
        let fixture = Fixture::new();
        let mut source = fixture.source("source", false);
        source.links[0].target = "missing-or-escaping".into();
        if escape {
            let outside = fixture.base.join("outside-file");
            put(&outside, "unrelated");
            symlink(outside, source.source.join("missing-or-escaping")).unwrap();
        }
        assert!(switch_links(&fixture.home, &source).is_err());
        assert!(!fixture.home.join(RECORD).exists());
    }
}

#[test]
fn refuses_settings_sessions_and_paths_outside_installer_resource_locations() {
    for destination in [
        "../outside",
        "/tmp/outside",
        ".claude/settings.json",
        ".pi/agent/settings.json",
        ".claude/projects/history",
        ".pi/agent/sessions/history",
        ".pi/agent/trust.json",
        ".local/state/ai-config/installation.json",
    ] {
        let fixture = Fixture::new();
        let mut source = fixture.source("source", false);
        source.links[0].destination = destination.into();
        assert!(
            switch_links(&fixture.home, &source).is_err(),
            "accepted {destination}"
        );
        assert!(!fixture.home.join(RECORD).exists());
    }
}

#[test]
fn rejects_invalid_manifest_paths_versions_duplicates_and_overlaps() {
    for kind in [
        "version",
        "relative-source",
        "parent-target",
        "absolute-target",
        "duplicate",
        "overlap",
    ] {
        let fixture = Fixture::new();
        let mut source = fixture.source("source", false);
        match kind {
            "version" => source.version = 99,
            "relative-source" => source.source = "relative".into(),
            "parent-target" => source.links[0].target = "../other".into(),
            "absolute-target" => source.links[0].target = "/tmp/other".into(),
            "duplicate" => source.links.push(source.links[0].clone()),
            "overlap" => {
                let mut nested = source.links[0].clone();
                nested.destination.push("nested");
                source.links.push(nested);
            }
            _ => unreachable!(),
        }
        assert!(
            switch_links(&fixture.home, &source).is_err(),
            "accepted {kind}"
        );
        assert!(fixture.home.join(CLAUDE_SKILL).symlink_metadata().is_err());
    }
}

#[test]
fn refuses_corrupt_or_unknown_ownership_records_without_changing_links() {
    for invalid in [
        "not json",
        "{}",
        r#"{"version":99,"source":"/tmp/source","links":[]}"#,
    ] {
        let fixture = Fixture::new();
        let shared = fixture.source("shared", true);
        let minimal = fixture.source("minimal", false);
        fixture.install(&shared);
        put(fixture.home.join(RECORD), invalid);
        assert!(switch_links(&fixture.home, &minimal).is_err());
        assert_eq!(
            fixture.target(CLAUDE_SKILL),
            shared.source.join("skills/selected")
        );
        assert_eq!(
            fixture.target(PI_SKILL),
            shared.source.join("skills/selected")
        );
        assert_eq!(fixture.record(), invalid.as_bytes());
    }
}

#[test]
fn refuses_unknown_ownership_fields_instead_of_discarding_them() {
    let fixture = Fixture::new();
    let shared = fixture.source("shared", true);
    let minimal = fixture.source("minimal", false);
    fixture.install(&shared);
    let mut record = serde_json::to_value(&shared).unwrap();
    record["future-ownership"] = serde_json::json!({"settings": true});
    put(fixture.home.join(RECORD), &record.to_string());
    assert!(switch_links(&fixture.home, &minimal).is_err());
    assert_eq!(
        fixture.target(CLAUDE_SKILL),
        shared.source.join("skills/selected")
    );
}

#[test]
fn refuses_raw_target_changes_that_path_equality_normalizes() {
    for suffix in ["extensions/obsolete.ts/", "extensions/./obsolete.ts"] {
        let fixture = Fixture::new();
        let shared = fixture.source("shared", true);
        let minimal = fixture.source("minimal", false);
        fixture.install(&shared);
        let changed = shared.source.join(suffix);
        let link = fixture.home.join(OBSOLETE);
        fs::remove_file(&link).unwrap();
        symlink(&changed, &link).unwrap();
        assert!(switch_links(&fixture.home, &minimal).is_err());
        fixture.assert_source(&shared);
        assert_eq!(
            fs::read_link(link).unwrap().as_os_str(),
            changed.as_os_str()
        );
    }
}

#[test]
fn rejects_relative_root_and_redirected_home_directories() {
    let fixture = Fixture::new();
    let source = fixture.source("source", false);
    let redirect = fixture.base.join("redirect");
    symlink(&fixture.home, &redirect).unwrap();
    for home in [
        std::path::Path::new("."),
        std::path::Path::new("/"),
        redirect.as_path(),
    ] {
        assert!(switch_links(home, &source).is_err());
    }
    assert_eq!(fs::read_dir(&fixture.home).unwrap().count(), 0);
}
