use crate::shared_legacy as fixture;
use evaluation::configuration::{Manifest, adopt_configuration, shared_legacy_inventory};
use fixture::SharedLegacyFixture;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;

fn desired(fixture: &SharedLegacyFixture) -> Manifest {
    let source = fixture.source.parent().unwrap().join("next");
    fs::create_dir(&source).unwrap();
    Manifest {
        version: 2,
        source,
        links: vec![],
        settings: vec![],
    }
}

fn assert_not_adopted(fixture: &SharedLegacyFixture) {
    assert_eq!(
        fs::read_link(fixture.home.join(".claude/settings.json")).unwrap(),
        fixture.source.join("harnesses/claude/settings.json")
    );
    assert!(
        !fixture
            .home
            .join(".local/state/ai-config/installation.json")
            .exists()
    );
}

#[test]
fn captured_claims_refuse_changed_owned_values_and_malformed_installed_templates() {
    for invalid in [
        r#"{"theme":"private-value"}"#,
        r#"{"theme":"one","theme":"two"}"#,
        r#"{"permissions":{"allow":"not-an-array"}}"#,
        r#"{"env":{"DISABLE_AUTOUPDATER":"private-value"}}"#,
        "private-value-not-json",
    ] {
        let fixture = SharedLegacyFixture::new();
        fixture.install_projection();
        fs::write(
            fixture.source.join("harnesses/claude/settings.json"),
            invalid,
        )
        .unwrap();
        let inventory =
            shared_legacy_inventory(&fixture.source, &fixture.upstream, &fixture.agentmemory)
                .unwrap();
        let error = adopt_configuration(&fixture.home, &desired(&fixture), &inventory.installation)
            .unwrap_err();
        assert!(!format!("{error:#}").contains("private-value"));
        assert_not_adopted(&fixture);
    }
}

#[test]
fn captured_claims_do_not_bypass_redirected_or_hardlinked_settings_source_checks() {
    for kind in ["symlink", "hardlink", "parent"] {
        let fixture = SharedLegacyFixture::new();
        fixture.install_projection();
        let path = fixture.source.join("harnesses/claude/settings.json");
        let outside = fixture.source.parent().unwrap().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::rename(&path, outside.join("settings.json")).unwrap();
        match kind {
            "symlink" => symlink(outside.join("settings.json"), &path).unwrap(),
            "hardlink" => fs::hard_link(outside.join("settings.json"), &path).unwrap(),
            "parent" => {
                fs::rename(path.parent().unwrap(), fixture.source.join("saved-module")).unwrap();
                symlink(&outside, path.parent().unwrap()).unwrap();
            }
            _ => unreachable!(),
        }
        let inventory =
            shared_legacy_inventory(&fixture.source, &fixture.upstream, &fixture.agentmemory)
                .unwrap();
        assert!(
            adopt_configuration(&fixture.home, &desired(&fixture), &inventory.installation)
                .is_err()
        );
        assert_not_adopted(&fixture);
    }
}

#[test]
fn requires_explicit_absolute_runtime_locations_without_running_or_resolving_them() {
    let fixture = SharedLegacyFixture::new();
    for invalid in [
        Path::new("relative"),
        Path::new("/"),
        Path::new("/tmp/../outside"),
    ] {
        assert!(shared_legacy_inventory(&fixture.source, invalid, &fixture.agentmemory).is_err());
        assert!(shared_legacy_inventory(&fixture.source, &fixture.upstream, invalid).is_err());
    }
    fs::remove_dir_all(fixture.upstream.parent().unwrap()).unwrap();
    fs::remove_dir_all(fixture.source.join("harnesses")).unwrap();
    // No source template or installed settings are needed to declare the frozen claims.
    assert!(
        shared_legacy_inventory(&fixture.source, &fixture.upstream, &fixture.agentmemory).is_ok()
    );
    assert_eq!(fs::read_dir(&fixture.home).unwrap().count(), 0);
}
