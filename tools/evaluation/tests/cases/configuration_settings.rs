use crate::fixture;
use fixture::{
    CLAUDE_SETTINGS as CLAUDE, Fixture, PI_SETTINGS as PI, configured, put, settings, with_settings,
};
use serde_json::json;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};

#[test]
fn does_not_rewrite_settings_on_repeat_installation_or_capture_unrelated_values_in_the_record() {
    let fixture = Fixture::new();
    let source = configured(
        fixture.source("source", false),
        "shared-theme",
        "Read(shared/**)",
    );
    fixture.install(&source);
    let customized = "{\"theme\":\"shared-theme\", \"personal\":\"private-value\"}\n";
    put(fixture.home.join(PI), customized);
    let inode = fs::metadata(fixture.home.join(PI)).unwrap().ino();
    fixture.install(&source);
    assert_eq!(
        fs::read_to_string(fixture.home.join(PI)).unwrap(),
        customized
    );
    assert_eq!(fs::metadata(fixture.home.join(PI)).unwrap().ino(), inode);
    assert!(
        !String::from_utf8(fixture.record())
            .unwrap()
            .contains("private-value")
    );
}

#[test]
fn removes_only_owned_settings_when_switching_to_a_link_only_source() {
    let fixture = Fixture::new();
    let source = configured(
        fixture.source("source", true),
        "shared-theme",
        "Read(shared/**)",
    );
    let minimal = fixture.source("minimal", false);
    put(
        fixture.home.join(CLAUDE),
        r#"{"permissions":{"allow":["Read(personal/**)"]},"model":"saved"}"#,
    );
    fixture.install(&source);
    fixture.install(&minimal);
    fixture.assert_source(&minimal);
    assert_eq!(
        settings(&fixture, CLAUDE),
        json!({"permissions":{"allow":["Read(personal/**)"]},"model":"saved"})
    );
    assert_eq!(settings(&fixture, PI), json!({}));
}

#[test]
fn upgrades_a_version_one_record_and_repairs_missing_owned_settings() {
    let fixture = Fixture::new();
    let links = fixture.source("source", false);
    fixture.install(&links);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fixture.record()).unwrap()["version"],
        1
    );
    let configured = configured(links, "shared-theme", "Read(shared/**)");
    fixture.install(&configured);
    fs::remove_file(fixture.home.join(PI)).unwrap();
    put(fixture.home.join(CLAUDE), "{}");
    fixture.install(&configured);
    assert_eq!(settings(&fixture, PI), json!({"theme":"shared-theme"}));
    assert_eq!(
        settings(&fixture, CLAUDE),
        json!({"theme":"shared-theme","permissions":{"allow":["Read(shared/**)"]}})
    );
}

#[test]
fn preserves_unknown_numeric_tokens_and_object_keys_without_float_conversion() {
    let fixture = Fixture::new();
    let source = configured(fixture.source("source", false), "theme", "Read(shared/**)");
    let number = "184467440737095516170123456789";
    put(
        fixture.home.join(PI),
        &format!(r#"{{"unknown":[{number},1e400,{{"$serde_json::private::Number":"literal"}}]}}"#),
    );
    fixture.install(&source);
    let installed = fs::read_to_string(fixture.home.join(PI)).unwrap();
    assert!(installed.contains(number));
    assert!(installed.contains("1e400"));
    assert!(installed.contains("$serde_json::private::Number"));
    assert!(installed.contains("literal"));
}

#[test]
fn preserves_native_preference_edits_between_switches_and_existing_file_modes() {
    let fixture = Fixture::new();
    let source = configured(
        fixture.source("source", false),
        "shared-theme",
        "Read(shared/**)",
    );
    let minimal = configured(
        fixture.source("minimal", false),
        "minimal-theme",
        "Read(minimal/**)",
    );
    fixture.install(&source);
    assert_eq!(
        fs::metadata(fixture.home.join(PI)).unwrap().mode() & 0o777,
        0o600
    );
    put(
        fixture.home.join(PI),
        r#"{"theme":"shared-theme","defaultModel":"new-choice"}"#,
    );
    fs::set_permissions(fixture.home.join(PI), fs::Permissions::from_mode(0o640)).unwrap();
    fixture.install(&minimal);
    assert_eq!(
        settings(&fixture, PI),
        json!({"theme":"minimal-theme","defaultModel":"new-choice"})
    );
    assert_eq!(
        fs::metadata(fixture.home.join(PI)).unwrap().mode() & 0o777,
        0o640
    );
}

#[test]
fn merges_plugin_fields_hook_groups_and_resource_entries_without_owning_their_neighbors() {
    let fixture = Fixture::new();
    let source = with_settings(
        fixture.source("source", false),
        json!([
            {"destination":CLAUDE,"path":["enabledPlugins","selected@local"],"mode":"value","value":true},
            {"destination":CLAUDE,"path":["hooks","PreToolUse"],"mode":"array_entry","value":{"hooks":[{"type":"command","command":"fixture-guard"}]}},
            {"destination":PI,"path":["extensions"],"mode":"array_entry","value":"selected-extension"}
        ]),
    );
    let claude = json!({"enabledPlugins":{"independent@managed":true},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"personal-hook"}]}]}});
    put(fixture.home.join(CLAUDE), &claude.to_string());
    put(fixture.home.join(PI), r#"{"extensions":["first","last"]}"#);
    fixture.install(&source);
    fixture.install(&source);
    assert_eq!(
        settings(&fixture, CLAUDE)["hooks"]["PreToolUse"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        settings(&fixture, PI)["extensions"],
        json!(["first", "last", "selected-extension"])
    );
    fixture.install(&fixture.source("minimal", false));
    assert_eq!(settings(&fixture, CLAUDE), claude);
    assert_eq!(
        settings(&fixture, PI),
        json!({"extensions":["first","last"]})
    );
}

#[test]
fn retains_shared_entries_and_the_order_and_multiplicity_of_personal_entries() {
    let fixture = Fixture::new();
    let claims = |entries: &[&str]| {
        json!(entries.iter().map(|entry| json!({"destination":PI,"path":["extensions"],"mode":"array_entry","value":entry})).collect::<Vec<_>>())
    };
    let source = with_settings(fixture.source("source", false), claims(&["A", "B"]));
    let next = with_settings(fixture.source("next", false), claims(&["B", "C"]));
    fixture.install(&source);
    put(
        fixture.home.join(PI),
        r#"{"extensions":["personal","A","personal","B","last"]}"#,
    );
    for _ in 0..2 {
        fixture.install(&next);
        assert_eq!(
            settings(&fixture, PI),
            json!({"extensions":["personal","personal","B","last","C"]})
        );
    }
    fixture.install(&fixture.source("minimal", false));
    assert_eq!(
        settings(&fixture, PI),
        json!({"extensions":["personal","personal","last"]})
    );
}

#[test]
fn switches_owned_settings_with_both_harnesses_and_preserves_unrelated_preferences() {
    let fixture = Fixture::new();
    let shared = configured(
        fixture.source("shared", true),
        "shared-theme",
        "Read(shared/**)",
    );
    let minimal = configured(
        fixture.source("minimal", false),
        "minimal-theme",
        "Read(minimal/**)",
    );
    put(
        fixture.home.join(CLAUDE),
        r#"{"model":"saved-model","permissions":{"allow":["Read(personal/**)"],"deny":["Bash(private)"]},"enabledPlugins":{"independent@managed":true}}"#,
    );
    put(
        fixture.home.join(PI),
        r#"{"defaultProvider":"saved-provider","defaultModel":"saved-model","defaultThinkingLevel":"high","defaultProjectTrust":"ask","extensions":["personal-extension"],"lastChangelogVersion":"saved-version"}"#,
    );
    for (manifest, theme, permission) in [
        (&shared, "shared-theme", "Read(shared/**)"),
        (&shared, "shared-theme", "Read(shared/**)"),
        (&minimal, "minimal-theme", "Read(minimal/**)"),
        (&minimal, "minimal-theme", "Read(minimal/**)"),
        (&shared, "shared-theme", "Read(shared/**)"),
    ] {
        fixture.install(manifest);
        fixture.assert_source(manifest);
        assert_eq!(
            settings(&fixture, CLAUDE),
            json!({"model":"saved-model","theme":theme,"permissions":{"allow":["Read(personal/**)",permission],"deny":["Bash(private)"]},"enabledPlugins":{"independent@managed":true}})
        );
        assert_eq!(
            settings(&fixture, PI),
            json!({"defaultProvider":"saved-provider","defaultModel":"saved-model","defaultThinkingLevel":"high","defaultProjectTrust":"ask","extensions":["personal-extension"],"lastChangelogVersion":"saved-version","theme":theme})
        );
    }
}
