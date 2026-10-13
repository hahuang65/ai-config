#[path = "support/configuration.rs"]
mod fixture;
use evaluation::configuration::{Manifest, switch_configuration};
use fixture::{
    CLAUDE_SETTINGS as CLAUDE, Fixture, PI_SETTINGS as PI, configured, put, with_settings,
};
use serde_json::{Value, json, value::RawValue};
use std::collections::BTreeMap;
use std::fs;

fn hook_source(fixture: &Fixture, timeout: Value) -> Manifest {
    with_settings(
        fixture.source("source", false),
        json!([
            {"destination":CLAUDE,"path":["hooks","PreToolUse"],"mode":"array_entry","value":{"hooks":[{"type":"command","command":"fixture-guard","timeout":timeout}]}}
        ]),
    )
}

#[test]
fn round_trips_owned_fractional_numbers_through_the_record_without_false_conflicts() {
    let fixture = Fixture::new();
    let source = hook_source(&fixture, json!(51.248178375505404));
    fixture.install(&source);
    fixture.install(&source);
    fixture.install(&fixture.source("minimal", false));
    assert_eq!(
        fixture::settings(&fixture, CLAUDE),
        json!({"hooks":{"PreToolUse":[]}})
    );
}

#[test]
fn refuses_equivalent_unowned_numbers_regardless_of_decimal_or_exponent_spelling() {
    for number in ["1e0", "1.00", "100e-2", "0.001e3"] {
        let fixture = Fixture::new();
        let source = hook_source(&fixture, json!(1));
        let original = format!(
            r#"{{"hooks":{{"PreToolUse":[{{"hooks":[{{"type":"command","command":"fixture-guard","timeout":{number}}}]}}]}}}}"#
        );
        put(fixture.home.join(CLAUDE), &original);
        assert!(
            switch_configuration(&fixture.home, &source).is_err(),
            "accepted {number}"
        );
        assert_eq!(
            fs::read_to_string(fixture.home.join(CLAUDE)).unwrap(),
            original
        );
    }
}

#[test]
fn rejects_numerically_equivalent_duplicate_array_claims() {
    let fixture = Fixture::new();
    let mut source = hook_source(&fixture, json!(1));
    let mut duplicate = source.settings[0].clone();
    duplicate.value["hooks"][0]["timeout"] = json!(1.0);
    source.settings.push(duplicate);
    assert!(switch_configuration(&fixture.home, &source).is_err());
    assert_eq!(fs::read_dir(&fixture.home).unwrap().count(), 0);
}

#[test]
fn does_not_confuse_distinct_large_integers_when_checking_array_ownership() {
    let fixture = Fixture::new();
    let source = hook_source(&fixture, json!(9007199254740993_u64));
    put(
        fixture.home.join(CLAUDE),
        r#"{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"fixture-guard","timeout":9007199254740992}]}]}}"#,
    );
    fixture.install(&source);
    fixture.install(&fixture.source("minimal", false));
    assert_eq!(
        fixture::settings(&fixture, CLAUDE)["hooks"]["PreToolUse"][0]["hooks"][0]["timeout"],
        json!(9007199254740992_u64)
    );
}

#[test]
fn preserves_unknown_subtree_structure_and_numeric_tokens_through_switch_repeat_and_removal() {
    let fixture = Fixture::new();
    let source = configured(fixture.source("source", false), "theme", "Read(source/**)");
    let minimal = configured(
        fixture.source("minimal", false),
        "other",
        "Read(minimal/**)",
    );
    let unknown = r#"{"numbers":[-0,0.12345678901234567890123456789,1e-99999999999999999999999999999999999999999999999999999,184467440737095516170123456789],"object":{"$serde_json::private::Number":"literal","nested":[true,null,"string"]}}"#;
    put(
        fixture.home.join(PI),
        &format!(r#"{{"unknown":{unknown}}}"#),
    );
    let before: BTreeMap<String, Box<RawValue>> = serde_json::from_str(unknown).unwrap();
    let links_only = fixture.source("links-only", false);
    for manifest in [&source, &source, &minimal, &links_only] {
        fixture.install(manifest);
        let installed: BTreeMap<String, Box<RawValue>> =
            serde_json::from_slice(&fs::read(fixture.home.join(PI)).unwrap()).unwrap();
        let subtree: BTreeMap<String, Box<RawValue>> =
            serde_json::from_str(installed["unknown"].get()).unwrap();
        let numbers: Vec<Box<RawValue>> = serde_json::from_str(subtree["numbers"].get()).unwrap();
        let original: Vec<Box<RawValue>> = serde_json::from_str(before["numbers"].get()).unwrap();
        assert_eq!(
            numbers.iter().map(|value| value.get()).collect::<Vec<_>>(),
            original.iter().map(|value| value.get()).collect::<Vec<_>>()
        );
        assert_eq!(subtree.len(), before.len());
        assert_eq!(
            serde_json::from_str::<Value>(subtree["object"].get()).unwrap(),
            serde_json::from_str::<Value>(before["object"].get()).unwrap()
        );
    }
}
