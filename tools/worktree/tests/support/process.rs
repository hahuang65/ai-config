use super::{Output, run, run_with_timeout};
use std::path::Path;
use std::time::{Duration, Instant};

// See test/timings.md before tuning these coupled fixture timings.
const TIMEOUT_DEADLINE: Duration = Duration::from_millis(100);
const CANCELLED_WRITE_DELAY: Duration = Duration::from_millis(200);
const CANCELLED_WRITE_OBSERVATION: Duration = Duration::from_millis(200);
const EXITED_WRITE_DELAY: Duration = Duration::from_millis(100);
const EXITED_WRITE_OBSERVATION: Duration = Duration::from_millis(200);
const DESCENDANT_READY_POLL: Duration = Duration::from_millis(5);

// Safety margins, not waits paid on successful runs.
const COMPLETION_GUARD: Duration = Duration::from_secs(1);
const PIPE_HOLD: Duration = Duration::from_secs(2);
const PROCESS_GUARD_SECONDS: u64 = 2;

#[test]
fn subprocess_deadlines_also_cover_inherited_output_pipes() {
    let started = Instant::now();
    // Static shell fixture; production execution never uses a shell.
    let result = run_with_timeout(
        Path::new("/"),
        &[
            "sh",
            "-c",
            "sleep \"$1\" & exit 0",
            "sh",
            &PIPE_HOLD.as_secs_f64().to_string(),
        ],
        false,
        TIMEOUT_DEADLINE,
    );
    assert!(result.unwrap_err().to_string().contains("timed out"));
    assert!(started.elapsed() >= TIMEOUT_DEADLINE);
    assert!(started.elapsed() < COMPLETION_GUARD);
}

#[test]
fn cancellation_prevents_a_descendant_from_writing_after_the_lock_is_released() {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("late-write");
    let ready = directory.path().join("ready");
    // The leader exits while its started descendant keeps the output pipe open.
    let result = run_with_timeout(
        Path::new("/"),
        &[
            "sh",
            "-c",
            "(printf ready > \"$2\"; sleep \"$3\"; printf late > \"$1\") & exit 0",
            "sh",
            marker.to_str().unwrap(),
            ready.to_str().unwrap(),
            &CANCELLED_WRITE_DELAY.as_secs_f64().to_string(),
        ],
        false,
        TIMEOUT_DEADLINE,
    );
    assert!(
        ready.exists(),
        "the descendant must start before cancellation"
    );
    assert!(result.unwrap_err().to_string().contains("timed out"));
    std::thread::sleep(CANCELLED_WRITE_OBSERVATION);
    assert!(
        !marker.exists(),
        "a cancelled command left a live descendant"
    );
}

#[test]
fn successful_leader_exit_stops_redirected_descendants_before_returning() {
    assert_eq!(redirected_descendant("0").unwrap().code, 0);
}

#[test]
fn failed_leader_exit_stops_redirected_descendants_before_returning() {
    assert_eq!(
        redirected_descendant("7").unwrap_err().to_string(),
        "sh -c failed (exit 7). Check repository access and state, then retry."
    );
}

fn redirected_descendant(exit: &str) -> crate::Result<Output> {
    let directory = tempfile::tempdir().unwrap();
    let marker = directory.path().join("late-write");
    let ready = directory.path().join("ready");
    let result = run(
        Path::new("/"),
        &[
            "sh",
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
        ],
        true,
        PROCESS_GUARD_SECONDS,
    );
    assert!(
        ready.exists(),
        "the descendant must start before leader exit"
    );
    std::thread::sleep(EXITED_WRITE_OBSERVATION);
    assert!(!marker.exists(), "an exited leader left a live descendant");
    result
}

#[test]
fn provider_errors_never_echo_stdout_or_stderr() {
    let result = run(
        Path::new("/"),
        &[
            "sh",
            "-c",
            "printf fixture-secret; printf fixture-secret >&2; exit 1",
        ],
        true,
        PROCESS_GUARD_SECONDS,
    );
    assert_eq!(
        result.unwrap_err().to_string(),
        "sh -c failed (exit 1). Check repository access and state, then retry."
    );
}
