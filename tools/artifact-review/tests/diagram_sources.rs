#[allow(dead_code)]
mod support;
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command};

fn input_repository() -> (support::Review, PathBuf, PathBuf) {
    let review = support::Review::new();
    let repo = review.root.join("input repo");
    fs::create_dir_all(repo.join(".git")).unwrap();
    fs::create_dir(repo.join("diagrams")).unwrap();
    fs::create_dir(repo.join("bin")).unwrap();
    let input = repo.join("diagrams/workflow.mmd");
    fs::write(&input, "flowchart TD\n A[Start] --> B[Done]\n").unwrap();
    let node = repo.join("bin/node");
    fs::write(
        &node,
        "#!/bin/sh\nprintf invoked > \"$SOURCE_NODE_CALLED\"\nprintf '<svg>wrong</svg>'\n",
    )
    .unwrap();
    fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).unwrap();
    (review, repo, input)
}

#[test]
fn outside_callers_never_execute_node_from_the_input_checkout_or_its_aliases() {
    let (review, repo, input) = input_repository();
    let caller = review.root.join("caller");
    fs::create_dir(&caller).unwrap();
    let linked_input = caller.join("linked.mmd");
    std::os::unix::fs::symlink(&input, &linked_input).unwrap();
    let alias = review.root.join("host-looking-bin");
    fs::create_dir(&alias).unwrap();
    std::os::unix::fs::symlink(repo.join("bin/node"), alias.join("node")).unwrap();
    let marker = review.root.join("source-node-invoked");
    for source in [&input, &linked_input] {
        for candidate in [repo.join("bin"), alias.clone()] {
            let output = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
                .args(["render-diagram", source.to_str().unwrap()])
                .current_dir(&caller)
                .env(
                    "PATH",
                    format!("{}:{}", candidate.display(), std::env::var("PATH").unwrap()),
                )
                .env("SOURCE_NODE_CALLED", &marker)
                .output()
                .unwrap();
            assert!(
                !marker.exists(),
                "Input-checkout Node executed from an outside caller"
            );
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8(output.stdout).unwrap().contains("Start"));
        }
    }
}
