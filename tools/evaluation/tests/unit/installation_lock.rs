use super::lock;
use std::{
    io,
    os::{fd::AsRawFd, unix::net::UnixStream},
};

const CHILD_GUARD_SECONDS: libc::c_uint = 5;

struct InheritedHandles {
    pid: Option<libc::pid_t>,
    _release: UnixStream,
}

impl InheritedHandles {
    fn new() -> Self {
        let (release, receiver) = UnixStream::pair().unwrap();
        let receiver_fd = receiver.as_raw_fd();
        // The child inherits the held lock but never executes Rust cleanup.
        // Only async-signal-safe calls are allowed after this multithreaded fork.
        let pid = unsafe { libc::fork() };
        assert!(pid >= 0, "Cannot fork lock-inheritance fixture");
        if pid == 0 {
            unsafe {
                libc::alarm(CHILD_GUARD_SECONDS);
                let mut byte = 0u8;
                let count = libc::read(receiver_fd, (&mut byte as *mut u8).cast(), 1);
                libc::_exit(if count == 1 { 0 } else { 1 });
            }
        }
        Self {
            pid: Some(pid),
            _release: release,
        }
    }

    fn assert_running(&mut self) {
        let pid = self.pid.expect("Child already reaped");
        let result = unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) };
        if result == pid {
            self.pid = None;
        }
        assert_eq!(
            result, 0,
            "Inherited lock handle must still be held by the child"
        );
    }
}

impl Drop for InheritedHandles {
    fn drop(&mut self) {
        if let Some(pid) = self.pid.take() {
            unsafe { libc::kill(pid, libc::SIGKILL) };
            loop {
                let result = unsafe { libc::waitpid(pid, std::ptr::null_mut(), 0) };
                if result >= 0 || io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
                    break;
                }
            }
        }
    }
}

#[test]
fn releases_after_success_or_error_even_while_a_child_holds_inherited_handles() {
    for fail in [false, true] {
        let temporary = tempfile::tempdir().unwrap();
        let state = temporary.path().canonicalize().unwrap().join("state");
        let mut child = None;
        let outcome: anyhow::Result<()> = (|| {
            let _owner = lock(&state)?;
            child = Some(InheritedHandles::new());
            assert!(
                lock(&state).is_err(),
                "An active installer must retain exclusion"
            );
            anyhow::ensure!(!fail, "Synthetic transaction failure");
            Ok(())
        })();
        assert_eq!(outcome.is_err(), fail);
        let mut child = child.unwrap();
        child.assert_running();
        let _next = lock(&state).unwrap_or_else(|error| {
            panic!("Completed transaction must release its lock before child exit: {error:#}")
        });
        child.assert_running();
    }
}
