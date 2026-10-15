use crate::support::{Trial, put, read_json};
use serde_json::json;
use std::{fs, os::unix::fs::symlink};

fn previous_commands(trial: &Trial) {
    let record = trial.home.join(".local/state/ai-config/installation.json");
    let mut previous = read_json(&record);
    let links = previous["links"].as_array_mut().unwrap();
    let old_review = "tools/evaluation/target/release/review-change-eval";
    let old_artifact = "tools/artifact-review/target/release/artifact-review";
    let review = links
        .iter_mut()
        .find(|link| link["destination"] == ".local/bin/review-change")
        .unwrap();
    review["destination"] = json!(".local/bin/review-change-eval");
    review["target"] = json!(old_review);
    links.push(json!({"destination": ".local/bin/artifact-review", "target": old_artifact}));
    fs::remove_file(trial.home.join(".local/bin/review-change")).unwrap();
    for (name, target) in [
        ("review-change-eval", old_review),
        ("artifact-review", old_artifact),
    ] {
        put(trial.root.join(target), "previous executable fixture\n");
        symlink(
            trial.root.join(target),
            trial.home.join(format!(".local/bin/{name}")),
        )
        .unwrap();
    }
    put(&record, previous.to_string());
}

#[test]
fn recorded_command_upgrade_removes_old_owned_aliases_and_keeps_private_helpers() {
    let trial = Trial::new();
    trial.install();
    previous_commands(&trial);
    put(trial.home.join("personal.txt"), "preserve me\n");
    trial.install();
    for name in [
        "review-change-eval",
        "artifact-review",
        "review-artifact",
        "consult",
    ] {
        assert!(
            trial
                .home
                .join(format!(".local/bin/{name}"))
                .symlink_metadata()
                .is_err()
        );
    }
    assert_eq!(
        fs::read_link(trial.home.join(".local/bin/review-change")).unwrap(),
        trial
            .root
            .join("tools/evaluation/target/release/review-change")
    );
    assert!(
        trial
            .root
            .join("tools/artifact-review/target/release/review-artifact")
            .is_file()
    );
    assert!(
        trial
            .root
            .join("tools/evaluation/target/release/consult")
            .is_file()
    );
    assert_eq!(
        fs::read_to_string(trial.home.join("personal.txt")).unwrap(),
        "preserve me\n"
    );
}
