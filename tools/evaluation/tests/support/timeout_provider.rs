//! Native, test-only provider for fixed-deadline diagnostic cases.
use std::env;

pub fn selected_exit() -> Option<i32> {
    let mode = env::var("EVALUATION_TIMEOUT_FIXTURE_MODE").ok()?;
    if mode == "warmup" {
        return Some(0);
    }
    if mode == "startup-delay" {
        // Deliberately stay silent so the real runner must time out during startup.
        unsafe {
            libc::sleep(30);
        }
        return Some(0);
    }
    if !matches!(mode.as_str(), "wait" | "exit" | "signal") {
        return Some(2);
    }
    emit_private_output();
    if mode == "wait" {
        // SAFETY: this standalone fixture owns its output descriptors and has no readers.
        unsafe {
            libc::close(libc::STDOUT_FILENO);
            libc::close(libc::STDERR_FILENO);
            libc::sleep(30);
        }
        return Some(0);
    }
    // SAFETY: this branch runs before the fixture starts threads or the shared runner.
    // The child uses only async-signal-safe libc calls before exiting.
    match unsafe { libc::fork() } {
        -1 => Some(2),
        0 => unsafe {
            libc::sleep(30);
            libc::_exit(0);
        },
        _ if mode == "signal" => {
            // No runner signal handlers are installed in this fixture process.
            unsafe {
                libc::raise(libc::SIGTERM);
            }
            Some(90)
        }
        _ => unsafe { libc::_exit(7) },
    }
}

fn emit_private_output() {
    let bytes = b"PRIVATE_TEST_SECRET";
    for descriptor in [libc::STDOUT_FILENO, libc::STDERR_FILENO] {
        // SAFETY: bytes points to a valid static buffer for the requested length.
        let count = unsafe { libc::write(descriptor, bytes.as_ptr().cast(), bytes.len()) };
        if count != bytes.len() as isize {
            // A failed setup must not look like a successful timeout diagnostic.
            unsafe {
                libc::_exit(2);
            }
        }
    }
}
