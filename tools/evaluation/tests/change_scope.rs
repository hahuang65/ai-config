mod support;
use serde_json::Value;
use std::{fs, os::unix::fs::PermissionsExt, path::Path};
use support::{change::*, *};

#[test]
fn explicit_path_scope_is_literal_and_recorded_in_both_local_and_range_reviews() {
    let trial = fixture();
    put(
        trial.temporary.path().join("repo/src[1]/module.rs"),
        "selected\n",
    );
    put(
        trial.temporary.path().join("repo/src1/other.rs"),
        "outside\n",
    );
    for target in ["local", "range"] {
        if target == "range" {
            git(&trial, &["add", "."]);
            git(&trial, &["commit", "-m", "paths"]);
        }
        let mut args = vec![target];
        if target == "range" {
            args.push("HEAD~1..HEAD");
        }
        args.extend(["--path", "src[1]"]);
        let output = review(&trial, &args);
        success(output.clone());
        let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
        let snapshot = Path::new(receipt["snapshot"].as_str().unwrap());
        assert!(snapshot.join("after/src[1]/module.rs").exists());
        assert!(!snapshot.join("after/src1").exists());
        assert!(!snapshot.join("after/source.txt").exists());
        let record: Value =
            serde_json::from_slice(&fs::read(receipt["record"].as_str().unwrap()).unwrap())
                .unwrap();
        assert_eq!(record["scope"]["path_filter"], "src[1]");
        assert!(
            fs::read_to_string(receipt["report"].as_str().unwrap())
                .unwrap()
                .contains("src[1]")
        );
    }
}

#[test]
fn added_and_deleted_executable_modes_are_not_replaced_with_snapshot_permissions() {
    let trial = fixture();
    let source = trial.temporary.path().join("repo/run.sh");
    put(&source, "fixture only\n");
    fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
    git(&trial, &["add", "run.sh"]);
    git(&trial, &["commit", "-m", "new executable"]);
    for range in ["HEAD~1..HEAD", "HEAD..HEAD~1"] {
        let output = review(&trial, &["range", range]);
        success(output.clone());
        let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
        let snapshot = Path::new(receipt["snapshot"].as_str().unwrap());
        let patch = fs::read_to_string(snapshot.join("patch.diff")).unwrap();
        assert!(patch.contains("file mode 100755"));
        assert!(!patch.contains("file mode 100644"));
        let manifest: Value =
            serde_json::from_slice(&fs::read(snapshot.join("scope.json")).unwrap()).unwrap();
        let side = if range == "HEAD~1..HEAD" {
            "after"
        } else {
            "before"
        };
        assert_eq!(manifest["modes"][side]["run.sh"], "100755");
    }
}
