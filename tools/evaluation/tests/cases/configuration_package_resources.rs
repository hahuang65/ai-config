use crate::support::package_fixture;
use crate::support::package_manifest::{catalogue_manifest, prepared_manifest};
use package_fixture::{fixture, manifest};
use serde_json::json;
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};

#[test]
fn prepared_package_requires_both_commit_skills_and_a_regular_skill_file() {
    for destination in [".claude/skills/commit", ".pi/agent/skills/commit"] {
        let fixture = fixture();
        manifest(fixture.path());
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["links"]
            .as_array_mut()
            .unwrap()
            .retain(|link| link["destination"] != destination);
        fs::write(&path, value.to_string()).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
    {
        let fixture = fixture();
        manifest(fixture.path());
        fs::remove_file(fixture.path().join("skills/commit/SKILL.md")).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }

    for invalid in [
        "Fixture; never run.\n",
        "---\nname: other\ndescription: Wrong skill.\n---\n\nFixture.\n",
        "---\nname: commit\ndescription: \n---\n\nFixture.\n",
        "---\nname: commit\ndescription: Empty instructions.\n---\n",
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        fs::write(fixture.path().join("skills/commit/SKILL.md"), invalid).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
}

#[test]
fn prepared_package_refuses_missing_non_executable_or_cross_wired_bundled_tools() {
    for relative in [
        "tools/worktree/target/release/wt",
        "tools/worklog/target/release/wl",
        "tools/artifact-review/target/release/review-artifact",
        "tools/evaluation/target/release/consult",
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        fs::remove_file(fixture.path().join(relative)).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
    for mode in [0o644, 0o001] {
        let fixture = fixture();
        manifest(fixture.path());
        fs::set_permissions(
            fixture.path().join("tools/worklog/target/release/wl"),
            fs::Permissions::from_mode(mode),
        )
        .unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }

    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["links"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|link| link["destination"] == ".local/bin/wt")
        .unwrap()["target"] = json!("tools/worklog/target/release/wl");
    fs::write(&path, manifest.to_string()).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
}

#[test]
fn prepared_package_refuses_missing_or_cross_harness_resources() {
    for (destination, target) in [
        (".claude/CLAUDE.md", "harnesses/claude/guard.ts"),
        (
            ".pi/agent/extensions/guard-policies.ts",
            "harnesses/claude/guard.ts",
        ),
        (".claude/hooks/guard.ts", "harnesses/pi/guard-policies.ts"),
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["links"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|link| link["destination"] == destination)
            .unwrap()["target"] = json!(target);
        fs::write(&path, value.to_string()).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
    let fixture = fixture();
    manifest(fixture.path());
    fs::remove_file(fixture.path().join("harnesses/pi/guard-policies.ts")).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    let missing_bundle = package_fixture::fixture();
    manifest(missing_bundle.path());
    fs::remove_file(
        missing_bundle
            .path()
            .join("harnesses/pi/guard-policies.bundle.ts"),
    )
    .unwrap();
    assert!(prepared_manifest(&missing_bundle.path().canonicalize().unwrap()).is_err());
}

#[test]
fn prepared_package_refuses_a_directory_instead_of_a_required_adapter() {
    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["links"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|link| link["destination"] == ".claude/hooks/guard.ts")
        .unwrap()["target"] = json!("harnesses/claude");
    fs::write(&path, value.to_string()).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
}

#[test]
fn prepared_package_refuses_symlinks_inside_linked_resource_directories() {
    for destination in ["harnesses/pi/guard-policies.ts", "outside"] {
        let fixture = fixture();
        manifest(fixture.path());
        let directory = fixture.path().join("skills");
        fs::create_dir_all(&directory).unwrap();
        symlink(
            fixture.path().join(destination),
            directory.join("redirected"),
        )
        .unwrap();
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["links"].as_array_mut().unwrap().push(json!({
            "destination": ".claude/skills/fixture", "target": "skills"
        }));
        fs::write(&path, value.to_string()).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
}

#[test]
fn prepared_package_accepts_regular_resources_inside_a_linked_skill_directory() {
    let fixture = fixture();
    manifest(fixture.path());
    let directory = fixture.path().join("skills/fixture");
    fs::create_dir_all(directory.join("references")).unwrap();
    fs::write(directory.join("SKILL.md"), "fixture\n").unwrap();
    fs::write(directory.join("references/guide.md"), "fixture\n").unwrap();
    let path = fixture.path().join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["links"].as_array_mut().unwrap().push(json!({
        "destination": ".pi/agent/skills/fixture", "target": "skills/fixture"
    }));
    fs::write(&path, value.to_string()).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_ok());
}

#[test]
fn prepared_package_requires_its_bootstrap_rule_files_even_when_not_linked() {
    for relative in [
        "rules/testing.md",
        "harnesses/claude/harness-rules.md",
        "harnesses/claude/guard-verdict.ts",
        "guard/guard-core.ts",
        "guard/command-invocations.ts",
        "guard/dangerous-command-guard.ts",
        "guard/recursive-delete-guard.ts",
        "guard/remote-execution-guard.ts",
        "guard/shell-parser.ts",
        "guard/vendor/tree-sitter.mjs",
        "guard/vendor/tree-sitter-bash.wasm",
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        fs::remove_file(fixture.path().join(relative)).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
}

#[test]
fn prepared_package_refuses_redirected_bootstrap_rules_and_wrong_adapter_targets() {
    {
        let fixture = fixture();
        manifest(fixture.path());
        let rule = fixture.path().join("rules/testing.md");
        fs::remove_file(&rule).unwrap();
        symlink(fixture.path().join("rules/a5.md"), &rule).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }

    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["links"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|link| link["destination"] == ".claude/CLAUDE.md")
        .unwrap()["target"] = json!("rules/testing.md");
    fs::write(&path, value.to_string()).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
}

#[test]
fn catalogue_requires_every_ordinary_harness_resource_link() {
    for destination in [
        ".claude/skills/plan",
        ".pi/agent/skills/worklog",
        ".claude/agents/api-designer.md",
        ".pi/agent/agents/fact-checker.md",
        ".pi/agent/extensions/guard-policies.ts",
        ".local/bin/wt",
        ".local/bin/wl",
        ".local/bin/review-change",
        ".claude/skills/review-change",
        ".pi/agent/skills/review-change",
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let links = value["links"].as_array_mut().unwrap();
        let original = links.len();
        links.retain(|link| link["destination"] != destination);
        assert_eq!(
            links.len(),
            original - 1,
            "missing fixture entry: {destination}"
        );
        fs::write(&path, value.to_string()).unwrap();
        assert!(
            catalogue_manifest(&fixture.path().canonicalize().unwrap()).is_err(),
            "{destination}"
        );
    }
}

#[test]
fn prepared_package_refuses_redirected_or_duplicate_manifests() {
    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let bytes = fs::read(&path).unwrap();
    fs::write(
        &path,
        format!(
            "{{\"version\":2,\"version\":2,\"source\":\"{}\",\"links\":[]}}",
            fixture.path().display()
        ),
    )
    .unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    fs::remove_file(&path).unwrap();
    fs::write(fixture.path().join("outside"), bytes).unwrap();
    symlink(fixture.path().join("outside"), &path).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
}
