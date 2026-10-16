mod support;

use std::fs;
use std::process::{Command, Output, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

fn bounded_output(command: &mut Command) -> Output {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if child
        .wait_timeout(Duration::from_secs(5))
        .unwrap()
        .is_none()
    {
        let _ = child.kill();
        let _ = child.wait();
        panic!("relocated fixture probe exceeded its watchdog");
    }
    child.wait_with_output().unwrap()
}

#[test]
fn fixture_lookup_follows_the_running_test_output_directory() {
    const PROBE: &str = "AI_TEST_RELOCATED_REVIEWER_FIXTURE";
    if std::env::var_os(PROBE).is_some() {
        let trial = support::Trial::new();
        let output = bounded_output(trial.command().args(["reviewer", "--help"]));
        support::success(output.clone());
        assert_eq!(output.stdout, b"SELECTED_OUTPUT_FIXTURE\n");
        return;
    }
    let temporary = tempfile::tempdir().unwrap();
    for profile in [
        "custom target/debug",
        "custom target/release",
        "target/triple/custom-profile",
    ] {
        let directory = temporary.path().join(profile);
        let test = directory.join("deps/relocated-tests");
        fs::create_dir_all(test.parent().unwrap()).unwrap();
        fs::copy(std::env::current_exe().unwrap(), &test).unwrap();
        support::executable(
            directory.join("examples/reviewer-fixture"),
            "#!/bin/sh\nprintf 'SELECTED_OUTPUT_FIXTURE\\n'\n",
        );
        let output = bounded_output(
            Command::new(test)
                .args([
                    "--exact",
                    "fixture_lookup_follows_the_running_test_output_directory",
                    "--nocapture",
                ])
                .env(PROBE, "1"),
        );
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
