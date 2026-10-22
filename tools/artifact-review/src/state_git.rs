use crate::paths::Result;
use std::{
    io::Read,
    os::{fd::AsRawFd, unix::process::CommandExt},
    path::Path,
    process::{Child, ChildStdout, Stdio},
    time::{Duration, Instant},
};

pub fn run(directory: &Path, args: &[&str]) -> Result<String> {
    let mut command = evaluation::change_command::command("git", &[directory])
        .map_err(|_| "Cannot find Git outside reviewed source on an absolute PATH entry. Install Git or set AR_ROOT.")?;
    let mut child = command
        .arg("--no-pager")
        .args(args)
        .current_dir(directory)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_COMMON_DIR")
        .env("GIT_CONFIG_COUNT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| "Cannot resolve shared review state. Install Git or set AR_ROOT.")?;
    let mut output = child
        .stdout
        .take()
        .ok_or("Cannot capture review-state discovery.")?;
    // SAFETY: output owns this open pipe; no other reader can change its descriptor flags.
    let flags = unsafe { libc::fcntl(output.as_raw_fd(), libc::F_GETFL) };
    let nonblocking = flags >= 0
        && unsafe { libc::fcntl(output.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) } >= 0;
    let result = if nonblocking {
        collect(&mut child, &mut output)
    } else {
        Err("Cannot bound review-state discovery.")
    };
    if result.is_err() {
        // SAFETY: spawn created a new process group whose positive ID is the child's PID.
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
        let _ = child.wait();
    }
    result
}

fn collect(child: &mut Child, output: &mut ChildStdout) -> Result<String> {
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    let mut finished = false;
    loop {
        match output.read(&mut buffer) {
            Ok(0) => finished = true,
            Ok(count) => bytes.extend_from_slice(&buffer[..count]),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => (),
            Err(_) => return Err("Cannot read review-state discovery output."),
        }
        if bytes.len() > 256 * 1024 {
            return Err("Review-state discovery output exceeds 256 KiB. Set AR_ROOT explicitly.");
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "Cannot inspect review-state discovery.")?
        {
            if !status.success() {
                return Err(
                    "Cannot resolve the primary checkout for review state. Set AR_ROOT explicitly.",
                );
            }
            if finished {
                return String::from_utf8(bytes).map_err(|_| "Review-state paths must be UTF-8.");
            }
        }
        if Instant::now() >= deadline {
            return Err(
                "Review-state discovery timed out after 3 seconds. Set AR_ROOT explicitly.",
            );
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
