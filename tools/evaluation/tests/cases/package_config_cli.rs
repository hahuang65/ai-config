use crate::support::{package_fixture, shell_install};
use std::fs;
use std::process::Command;

#[test]
fn shell_installer_loads_a_package_without_an_evaluation_profile_or_herdr() {
    let package = package_fixture::fixture();
    package_fixture::manifest(package.path());
    assert!(!package.path().join("profile").exists());
    assert!(!package.path().join("herdr").exists());
    let home = tempfile::tempdir().unwrap();
    let root = package.path().canonicalize().unwrap();
    let canonical_home = home.path().canonicalize().unwrap();
    let output = shell_install::command(&root, &canonical_home)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let record =
        fs::read_to_string(home.path().join(".local/state/ai-config/installation.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&record).unwrap();
    assert!(
        value["links"]
            .as_array()
            .unwrap()
            .iter()
            .any(|link| link["destination"] == ".local/bin/wt")
    );
    assert!(
        value["links"]
            .as_array()
            .unwrap()
            .iter()
            .any(|link| link["destination"] == ".pi/agent/skills/commit")
    );
    for name in ["wt", "wl"] {
        assert_eq!(
            fs::read_link(canonical_home.join(format!(".local/bin/{name}"))).unwrap(),
            root.join(format!(
                "tools/{}/target/release/{name}",
                if name == "wt" { "worktree" } else { "worklog" }
            ))
        );
    }
    for name in ["artifact-review", "review-artifact", "consult"] {
        assert!(
            canonical_home
                .join(format!(".local/bin/{name}"))
                .symlink_metadata()
                .is_err()
        );
    }
    for helper in [
        "tools/artifact-review/target/release/review-artifact",
        "tools/evaluation/target/release/consult",
    ] {
        assert!(root.join(helper).is_file());
    }
    let repeated = shell_install::command(&root, &canonical_home)
        .output()
        .unwrap();
    assert!(
        repeated.status.success(),
        "{}",
        String::from_utf8_lossy(&repeated.stderr)
    );
    assert_eq!(
        fs::read_to_string(canonical_home.join(".local/state/ai-config/installation.json"))
            .unwrap(),
        record
    );
    assert!(!home.path().join(".state/pi").exists());
}

#[test]
fn public_review_cli_does_not_offer_trial_profile_or_service_installation() {
    let output = Command::new(env!("CARGO_BIN_EXE_review-change"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("Usage: review-change [SUBJECT]"));
    assert!(!help.contains("native-install"));
    assert!(!help.contains("herdr"));
    assert!(!help.contains("pi-minimal"));
    assert!(!help.contains("install|uninstall"));
}

#[test]
fn restricted_reviewer_resolves_the_root_source_without_a_trial_profile() {
    let package = package_fixture::fixture();
    package_fixture::manifest(package.path());
    let source = package.path().canonicalize().unwrap();
    let paths = evaluation::paths::Paths::new(Some(source.clone())).unwrap();
    assert_eq!(paths.source, source);
    assert_eq!(paths.state, paths.home.join(".local/state/ai-config"));
}

#[test]
fn restricted_pi_reviewer_gets_a_private_ephemeral_profile_without_discovery() {
    let package = package_fixture::fixture();
    package_fixture::manifest(package.path());
    let home = tempfile::tempdir().unwrap();
    let agent_dir = home.path().join(".pi/agent");
    fs::create_dir_all(&agent_dir).unwrap();
    fs::write(
        agent_dir.join("settings.json"),
        r#"{"defaultModel":"sonnet","extensions":["personal"]}"#,
    )
    .unwrap();
    fs::write(agent_dir.join("auth.json"), "synthetic-only").unwrap();
    fs::write(agent_dir.join("models.json"), "synthetic-model-only").unwrap();
    let root = package.path().canonicalize().unwrap();
    let paths = evaluation::paths::Paths {
        root: root.clone(),
        source: root.clone(),
        home: home.path().canonicalize().unwrap(),
        state: home.path().join(".local/state/ai-config"),
        profile: home.path().join(".local/state/ai-config/reviewer-pi"),
        executable: std::path::PathBuf::new(),
    };
    let profile = evaluation::reviewer::isolated_profile(&paths).unwrap();
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(profile.path().join("settings.json")).unwrap()).unwrap();
    assert_eq!(value["defaultModel"], "sonnet");
    assert_eq!(value["defaultProjectTrust"], "never");
    assert_eq!(value["extensions"], serde_json::json!([]));
    assert!(!profile.path().join("rules").exists());
    assert_eq!(
        fs::read_link(profile.path().join("auth.json")).unwrap(),
        paths.home.join(".pi/agent/auth.json")
    );
    assert_eq!(
        fs::read_link(profile.path().join("models.json")).unwrap(),
        paths.home.join(".pi/agent/models.json")
    );
    assert!(!root.join(".state/pi").exists());
}

#[test]
fn this_checkout_prepares_the_mvp_catalogue_from_release_builds() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let manifest = crate::support::package_manifest::prepared_manifest(&source).unwrap();
    assert!(
        manifest
            .links
            .iter()
            .any(|link| link.destination == std::path::Path::new(".local/bin/wt"))
    );
    assert!(
        manifest
            .links
            .iter()
            .any(|link| link.destination == std::path::Path::new(".local/bin/wl"))
    );
    assert!(
        !manifest
            .links
            .iter()
            .any(|link| link.destination == std::path::Path::new(".local/bin/pi-lsp"))
    );
    assert!(!manifest.links.iter().any(
        |link| link.destination == std::path::Path::new(".pi/agent/extensions/local-models.ts")
    ));
}

#[test]
fn recorded_source_switch_removes_the_retired_extension_and_preserves_personal_state() {
    let old = package_fixture::fixture();
    package_fixture::manifest(old.path());
    let old_root = old.path().canonicalize().unwrap();
    fs::write(
        old_root.join("harnesses/pi/local-models.ts"),
        "// old optional extension\n",
    )
    .unwrap();
    let file = old_root.join("manifest.json");
    let mut previous: serde_json::Value =
        serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    let links = previous["links"].as_array_mut().unwrap();
    links.push(serde_json::json!({
        "destination": ".pi/agent/extensions/local-models.ts", "target": "harnesses/pi/local-models.ts"
    }));
    fs::write(file, previous.to_string()).unwrap();
    let next = package_fixture::fixture();
    package_fixture::manifest(next.path());
    let home = tempfile::tempdir().unwrap();
    let canonical_home = home.path().canonicalize().unwrap();
    crate::support::success(
        shell_install::command(&old_root, &canonical_home)
            .output()
            .unwrap(),
    );
    let personal = canonical_home.join(".pi/agent/extensions/personal.ts");
    fs::write(&personal, "// Personal; never replace.\n").unwrap();
    let output = shell_install::command(&next.path().canonicalize().unwrap(), &canonical_home)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::read_to_string(personal).unwrap(),
        "// Personal; never replace.\n"
    );
    assert!(
        !canonical_home
            .join(".pi/agent/extensions/local-models.ts")
            .exists()
    );
    let link = canonical_home.join(".pi/agent/extensions/guard-policies.ts");
    assert_eq!(
        fs::read_link(link).unwrap(),
        next.path()
            .canonicalize()
            .unwrap()
            .join("harnesses/pi/guard-policies.bundle.ts")
    );
    let record: serde_json::Value = serde_json::from_slice(
        &fs::read(canonical_home.join(".local/state/ai-config/installation.json")).unwrap(),
    )
    .unwrap();
    assert!(
        record["links"]
            .as_array()
            .unwrap()
            .iter()
            .any(|link| link["destination"] == ".local/bin/wl")
    );
    assert!(
        !record["links"]
            .as_array()
            .unwrap()
            .iter()
            .any(|link| link["destination"] == ".pi/agent/extensions/local-models.ts")
    );
    assert!(!canonical_home.join(".state/pi").exists());
}
