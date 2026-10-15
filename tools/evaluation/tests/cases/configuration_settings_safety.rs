use crate::fixture;
use evaluation::configuration::switch_configuration;
use fixture::{
    CLAUDE_SETTINGS as CLAUDE, CLAUDE_SKILL, Fixture, PI_SETTINGS as PI, configured, put,
    with_settings,
};
use serde_json::json;
use std::fs;
use std::os::unix::fs::symlink;

#[test]
fn refuses_unowned_settings_even_when_the_existing_value_matches() {
    for value in ["shared-theme", "personal-theme"] {
        let fixture = Fixture::new();
        let source = configured(
            fixture.source("source", false),
            "shared-theme",
            "Read(shared/**)",
        );
        let original = json!({"theme":value}).to_string();
        put(fixture.home.join(PI), &original);
        assert!(switch_configuration(&fixture.home, &source).is_err());
        assert_eq!(fs::read_to_string(fixture.home.join(PI)).unwrap(), original);
        assert!(fixture.home.join(CLAUDE_SKILL).symlink_metadata().is_err());
        assert!(!fixture.home.join(CLAUDE).exists());
    }
}

#[test]
fn refuses_an_unowned_array_entry_without_claiming_or_duplicating_it() {
    let fixture = Fixture::new();
    let source = configured(
        fixture.source("source", false),
        "shared-theme",
        "Read(shared/**)",
    );
    let original = r#"{"permissions":{"allow":["Read(shared/**)"]}}"#;
    put(fixture.home.join(CLAUDE), original);
    assert!(switch_configuration(&fixture.home, &source).is_err());
    assert_eq!(
        fs::read_to_string(fixture.home.join(CLAUDE)).unwrap(),
        original
    );
    assert!(!fixture.home.join(PI).exists());
}

#[test]
fn refuses_modified_or_duplicate_owned_values_before_changing_either_harness() {
    for changed in [
        r#"{"theme":"personal","permissions":{"allow":["Read(shared/**)"]}}"#,
        r#"{"theme":"shared-theme","permissions":{"allow":[]}}"#,
        r#"{"theme":"shared-theme","permissions":{"allow":["Read(shared/**)","Read(shared/**)"]}}"#,
        r#"{"theme":"shared-theme","permissions":"replaced-parent"}"#,
    ] {
        let fixture = Fixture::new();
        let source = configured(
            fixture.source("source", true),
            "shared-theme",
            "Read(shared/**)",
        );
        fixture.install(&source);
        let before = fixture.record();
        put(fixture.home.join(CLAUDE), changed);
        assert!(switch_configuration(&fixture.home, &fixture.source("minimal", false)).is_err());
        fixture.assert_source(&source);
        assert_eq!(fixture.record(), before);
        assert_eq!(
            fs::read_to_string(fixture.home.join(CLAUDE)).unwrap(),
            changed
        );
    }
}

#[test]
fn rejects_invalid_json_and_duplicate_keys_without_exposing_contents() {
    for invalid in [
        "private-value-not-json",
        "null",
        "[]",
        r#"{"theme":"private-value-not-json","theme":"second"}"#,
        r#"{"unrelated":{"key":1,"k\u0065y":2}}"#,
        r#"{"nested":[{"key":1,"key":2}]}"#,
    ] {
        let fixture = Fixture::new();
        let source = configured(fixture.source("source", false), "theme", "Read(shared/**)");
        put(fixture.home.join(PI), invalid);
        let error = switch_configuration(&fixture.home, &source).unwrap_err();
        assert!(!format!("{error:#}").contains("private-value-not-json"));
        assert_eq!(fs::read_to_string(fixture.home.join(PI)).unwrap(), invalid);
        assert!(fixture.home.join(CLAUDE_SKILL).symlink_metadata().is_err());
    }
}

#[test]
fn rejects_linked_settings_and_redirected_parents_without_touching_their_targets() {
    for kind in ["symlink", "hardlink", "directory", "parent"] {
        let fixture = Fixture::new();
        let source = configured(fixture.source("source", false), "theme", "Read(shared/**)");
        let outside = fixture.base.join("outside");
        put(outside.join("settings.json"), r#"{"model":"personal"}"#);
        let path = fixture.home.join(PI);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        match kind {
            "symlink" => symlink(outside.join("settings.json"), &path).unwrap(),
            "hardlink" => fs::hard_link(outside.join("settings.json"), &path).unwrap(),
            "directory" => fs::create_dir(&path).unwrap(),
            "parent" => {
                fs::remove_dir(path.parent().unwrap()).unwrap();
                symlink(&outside, path.parent().unwrap()).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(switch_configuration(&fixture.home, &source).is_err());
        assert_eq!(
            fs::read_to_string(outside.join("settings.json")).unwrap(),
            r#"{"model":"personal"}"#
        );
        assert!(fixture.home.join(CLAUDE_SKILL).symlink_metadata().is_err());
    }
}

#[test]
fn refuses_ownership_of_preferences_authentication_trust_and_storage_fields() {
    for (destination, path) in [
        (PI, vec!["defaultModel"]),
        (PI, vec!["defaultProvider"]),
        (PI, vec!["defaultThinkingLevel"]),
        (PI, vec!["enabledModels"]),
        (PI, vec!["defaultProjectTrust"]),
        (PI, vec!["sessionDir"]),
        (CLAUDE, vec!["model"]),
        (CLAUDE, vec!["env", "ANTHROPIC_API_KEY"]),
        (".pi/agent/auth.json", vec!["theme"]),
        (".claude.json", vec!["theme"]),
    ] {
        let fixture = Fixture::new();
        let source = with_settings(
            fixture.source("source", false),
            json!([
                {"destination":destination,"path":path,"mode":"value","value":"not-owned"}
            ]),
        );
        assert!(switch_configuration(&fixture.home, &source).is_err());
        assert_eq!(fs::read_dir(&fixture.home).unwrap().count(), 0);
    }
}

#[test]
fn rejects_duplicate_claims_whole_object_replacement_wrong_types_and_version_one_settings() {
    for kind in ["duplicate", "object", "parent", "type", "version"] {
        let fixture = Fixture::new();
        let mut source = configured(fixture.source("source", false), "theme", "Read(shared/**)");
        match kind {
            "duplicate" => source.settings.push(source.settings[0].clone()),
            "object" => source.settings[0].value = json!({"unrelated":"value"}),
            "parent" => source.settings[1].path = vec!["permissions".into()],
            "type" => source.settings[0].value = json!(true),
            "version" => source.version = 1,
            _ => unreachable!(),
        }
        assert!(switch_configuration(&fixture.home, &source).is_err());
        assert_eq!(fs::read_dir(&fixture.home).unwrap().count(), 0);
    }
}

#[test]
fn rejects_excessive_json_depth_before_any_managed_resource_changes() {
    let fixture = Fixture::new();
    let source = configured(fixture.source("source", false), "theme", "Read(shared/**)");
    let nested = format!("{{\"unrelated\":{}0{}}}", "[".repeat(150), "]".repeat(150));
    put(fixture.home.join(PI), &nested);
    assert!(switch_configuration(&fixture.home, &source).is_err());
    assert_eq!(fs::read_to_string(fixture.home.join(PI)).unwrap(), nested);
    assert!(fixture.home.join(CLAUDE_SKILL).symlink_metadata().is_err());
}
