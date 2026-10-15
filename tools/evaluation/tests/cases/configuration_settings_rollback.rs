use crate::fixture;
use evaluation::configuration::{Manifest, switch_configuration};
use fixture::{CLAUDE_SETTINGS as CLAUDE, Fixture, PI_SETTINGS as PI, configured, put};
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};

fn fail_with_readonly_directory(fixture: &Fixture, manifest: &Manifest, directory: &str) {
    let path = fixture.home.join(directory);
    let permissions = fs::metadata(&path).unwrap().permissions();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o500)).unwrap();
    let outcome = switch_configuration(&fixture.home, manifest);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(
        outcome.is_err(),
        "This failure fixture requires an unprivileged user"
    );
}

#[test]
fn restores_both_settings_files_and_links_after_record_or_settings_write_failure() {
    for directory in [".local/state/ai-config", ".claude", ".pi/agent"] {
        let fixture = Fixture::new();
        let source = configured(
            fixture.source("source", true),
            "shared-theme",
            "Read(shared/**)",
        );
        let minimal = configured(
            fixture.source("minimal", false),
            "minimal-theme",
            "Read(minimal/**)",
        );
        fixture.install(&source);
        let claude = "{\"theme\":\"shared-theme\", \"permissions\":{\"allow\":[\"Read(shared/**)\"]}, \"model\":\"personal\"}\n";
        let pi = "{\"theme\":\"shared-theme\", \"defaultModel\":\"personal\"}\n";
        put(fixture.home.join(CLAUDE), claude);
        put(fixture.home.join(PI), pi);
        fs::set_permissions(fixture.home.join(CLAUDE), fs::Permissions::from_mode(0o640)).unwrap();
        let record = fixture.record();
        fail_with_readonly_directory(&fixture, &minimal, directory);
        fixture.assert_source(&source);
        assert_eq!(
            fs::read_to_string(fixture.home.join(CLAUDE)).unwrap(),
            claude
        );
        assert_eq!(fs::read_to_string(fixture.home.join(PI)).unwrap(), pi);
        assert_eq!(
            fs::metadata(fixture.home.join(CLAUDE)).unwrap().mode() & 0o777,
            0o640
        );
        assert_eq!(fixture.record(), record);
    }
}

#[test]
fn removes_new_settings_files_and_links_when_record_saving_fails() {
    let fixture = Fixture::new();
    let minimal = fixture.source("minimal", false);
    let source = configured(
        fixture.source("source", true),
        "shared-theme",
        "Read(shared/**)",
    );
    fixture.install(&minimal);
    let record = fixture.record();
    fail_with_readonly_directory(&fixture, &source, ".local/state/ai-config");
    fixture.assert_source(&minimal);
    assert!(fixture.home.join(CLAUDE).symlink_metadata().is_err());
    assert!(fixture.home.join(PI).symlink_metadata().is_err());
    assert_eq!(fixture.record(), record);
}
