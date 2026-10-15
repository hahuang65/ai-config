use super::run;
use std::{process::Command, thread, time::Duration};

// See test/timings.md for the coupled delayed-write and observation budgets.
const EXITED_WRITE_DELAY: Duration = Duration::from_millis(100);
const EXITED_WRITE_OBSERVATION: Duration = Duration::from_millis(200);
const DESCENDANT_READY_POLL: Duration = Duration::from_millis(5);
const PROCESS_GUARD_SECONDS: u64 = 2;

#[test]
fn completed_reviewer_stops_redirected_descendants_before_returning() {
    assert!(redirected_descendant("0").is_ok());
}

#[test]
fn failed_reviewer_stops_redirected_descendants_before_returning() {
    assert!(redirected_descendant("7").is_err());
}

fn redirected_descendant(exit: &str) -> anyhow::Result<Vec<u8>> {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("late-write");
    let ready = directory.path().join("ready");
    let mut command = Command::new("sh");
    command.args([
        "-c",
        concat!(
            "(printf ready > \"$2\"; sleep \"$4\"; printf late > \"$1\") >/dev/null 2>&1 & ",
            "while [ ! -f \"$2\" ]; do sleep \"$5\"; done; exit \"$3\""
        ),
        "sh",
        marker.to_str().unwrap(),
        ready.to_str().unwrap(),
        exit,
        &EXITED_WRITE_DELAY.as_secs_f64().to_string(),
        &DESCENDANT_READY_POLL.as_secs_f64().to_string(),
    ]);
    let result = run(command, PROCESS_GUARD_SECONDS);
    assert!(
        ready.exists(),
        "the descendant must start before leader exit"
    );
    thread::sleep(EXITED_WRITE_OBSERVATION);
    assert!(
        !marker.exists(),
        "an exited reviewer left a live descendant"
    );
    result
}
