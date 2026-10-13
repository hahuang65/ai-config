#[path = "support/shared_legacy.rs"]
mod fixture;
#[path = "support/service_sentinels.rs"]
mod service_sentinels;
use evaluation::configuration::{
    LegacyBoundary, Manifest, adopt_configuration, shared_legacy_inventory,
};
use fixture::SharedLegacyFixture;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

#[test]
fn adopts_the_captured_projection_without_losing_preferences_or_unrelated_resources() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let inventory =
        shared_legacy_inventory(&fixture.source, &fixture.upstream, &fixture.agentmemory).unwrap();
    let claude_source = fixture.source.join("harnesses/claude/settings.json");
    let original = personalize(&fixture);
    symlink(
        &fixture.agentmemory,
        fixture.home.join(".local/bin/agentmemory"),
    )
    .unwrap();
    let independent = fixture.source.join("independent-typesafe");
    symlink(
        &independent,
        fixture.home.join(".pi/agent/skills/typesafe-ai"),
    )
    .unwrap();
    let next = fixture.source.parent().unwrap().join("next");
    fs::create_dir(&next).unwrap();
    let desired = Manifest {
        version: 2,
        source: next,
        links: vec![],
        settings: vec![],
    };
    adopt_configuration(&fixture.home, &desired, &inventory.installation).unwrap();
    assert_eq!(
        fixture.links(),
        [(PathBuf::from(".pi/agent/skills/typesafe-ai"), independent)]
            .into_iter()
            .collect()
    );
    assert_kept_preferences(&fixture);
    assert_eq!(fs::read(claude_source).unwrap(), original);
}

fn personalize(fixture: &SharedLegacyFixture) -> Vec<u8> {
    let original = fs::read(fixture.source.join("harnesses/claude/settings.json")).unwrap();
    let mut claude: Value = serde_json::from_slice(&original).unwrap();
    claude["model"] = json!("personal-model");
    claude["permissions"]["allow"]
        .as_array_mut()
        .unwrap()
        .push(json!("Read(personal/**)"));
    fs::remove_file(fixture.home.join(".claude/settings.json")).unwrap();
    fs::write(
        fixture.home.join(".claude/settings.json"),
        claude.to_string(),
    )
    .unwrap();
    original
}

fn assert_kept_preferences(fixture: &SharedLegacyFixture) {
    let installed: Value =
        serde_json::from_slice(&fs::read(fixture.home.join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(
        installed,
        json!({
            "model": "personal-model", "env": {}, "statusLine": {}, "enabledPlugins": {},
            "permissions": {"allow": ["Read(personal/**)"], "deny": [], "ask": [], "additionalDirectories": []},
            "hooks": {"SessionStart": [], "SessionEnd": [], "UserPromptSubmit": [], "PreToolUse": [], "PostToolUse": [], "PostToolUseFailure": [], "Stop": []}
        })
    );
    let pi: Value =
        serde_json::from_slice(&fs::read(fixture.home.join(".pi/agent/settings.json")).unwrap())
            .unwrap();
    assert_eq!(
        pi,
        json!({"defaultProvider":"opencode","defaultThinkingLevel":"high"})
    );
}

#[test]
fn does_not_claim_personal_additions_written_through_the_legacy_settings_link() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let path = fixture.source.join("harnesses/claude/settings.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["permissions"]["allow"]
        .as_array_mut()
        .unwrap()
        .push(json!("Read(personal/**)"));
    value["personal-integration"] = json!("private-fixture-value");
    value["permissions"]["new-permission"] = json!([]);
    fs::write(&path, value.to_string()).unwrap();
    let inventory =
        shared_legacy_inventory(&fixture.source, &fixture.upstream, &fixture.agentmemory).unwrap();
    let next = fixture.source.parent().unwrap().join("next");
    fs::create_dir(&next).unwrap();
    let desired = Manifest {
        version: 2,
        source: next,
        links: vec![],
        settings: vec![],
    };
    adopt_configuration(&fixture.home, &desired, &inventory.installation).unwrap();
    let installed: Value =
        serde_json::from_slice(&fs::read(fixture.home.join(".claude/settings.json")).unwrap())
            .unwrap();
    assert_eq!(
        installed["permissions"]["allow"],
        json!(["Read(personal/**)"])
    );
    assert_eq!(installed["personal-integration"], "private-fixture-value");
    assert_eq!(installed["permissions"]["new-permission"], json!([]));
    assert!(
        !fs::read_to_string(
            fixture
                .home
                .join(".local/state/ai-config/installation.json")
        )
        .unwrap()
        .contains("private-fixture-value")
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap(),
        value
    );
}

#[test]
fn classifies_service_and_state_artifacts_without_giving_the_adopter_authority_over_them() {
    let fixture = SharedLegacyFixture::new();
    let inventory =
        shared_legacy_inventory(&fixture.source, &fixture.upstream, &fixture.agentmemory).unwrap();
    for artifact in &inventory.outside_switch {
        assert!(
            !inventory
                .installation
                .links
                .iter()
                .any(|link| link.destination == artifact.destination)
        );
    }
    assert!(
        inventory
            .outside_switch
            .iter()
            .any(|artifact| artifact.destination
                == Path::new("Library/LaunchAgents/dev.agentmemory.plist")
                && artifact.boundary == LegacyBoundary::AgentmemoryServiceRetirement)
    );
    assert!(
        inventory
            .outside_switch
            .iter()
            .any(
                |artifact| artifact.destination == Path::new(".local/bin/review-publication")
                    && artifact.boundary == LegacyBoundary::ReviewPublicationIntegration
            )
    );
    assert!(
        inventory
            .outside_switch
            .iter()
            .any(|artifact| artifact.destination == Path::new("data")
                && artifact.boundary == LegacyBoundary::PreserveState)
    );
    assert_eq!(fs::read_dir(&fixture.home).unwrap().count(), 0);
    assert!(!fixture.source.join("service-calls").exists());
}

#[test]
fn adoption_leaves_service_files_generated_launchers_and_historical_data_unchanged() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let inventory =
        shared_legacy_inventory(&fixture.source, &fixture.upstream, &fixture.agentmemory).unwrap();
    let sentinels = service_sentinels::Sentinels::new(&fixture.home, &fixture.source);
    let next = fixture.source.parent().unwrap().join("next");
    fs::create_dir(&next).unwrap();
    let desired = Manifest {
        version: 2,
        source: next,
        links: vec![],
        settings: vec![],
    };
    adopt_configuration(&fixture.home, &desired, &inventory.installation).unwrap();
    sentinels.assert_unchanged();
}

#[test]
fn inventories_every_link_emitted_by_the_captured_default_harness_installer() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let inventory =
        shared_legacy_inventory(&fixture.source, &fixture.upstream, &fixture.agentmemory).unwrap();
    let mut declared: BTreeMap<_, _> = inventory
        .installation
        .links
        .iter()
        .chain(&inventory.installation.settings_links)
        .map(|link| (link.destination.clone(), link.target.clone()))
        .collect();
    // Service activation is excluded from the captured projection test.
    assert_eq!(
        declared.remove(&PathBuf::from(".local/bin/agentmemory")),
        Some(fixture.agentmemory.clone())
    );
    assert_eq!(fixture.links(), declared);
}
