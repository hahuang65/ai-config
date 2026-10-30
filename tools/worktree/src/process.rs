//! Bounded, shell-free subprocesses. Never include provider output in errors.
use crate::{Error, Result, text};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicBool, Ordering},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const OUTPUT_LIMIT: usize = 8_000_000;
const POLL_INTERVAL: Duration = Duration::from_millis(5);
static INTERRUPTED: OnceLock<Arc<AtomicBool>> = OnceLock::new();

pub fn install_interrupt_handler() -> Result<()> {
    let flag = Arc::new(AtomicBool::new(false));
    for signal in [signal_hook::consts::SIGINT, signal_hook::consts::SIGTERM] {
        signal_hook::flag::register(signal, flag.clone())?;
    }
    let _ = INTERRUPTED.set(flag);
    Ok(())
}

pub fn interrupted() -> bool {
    INTERRUPTED
        .get()
        .is_some_and(|flag| flag.load(Ordering::Relaxed))
}

#[derive(Debug)]
pub struct Output {
    pub code: i32,
    pub stdout: String,
    /// Unnormalized output for NUL-delimited filenames.
    pub raw_stdout: Vec<u8>,
}

pub fn run(cwd: &Path, arguments: &[&str], check: bool, seconds: u64) -> Result<Output> {
    run_with_timeout(cwd, arguments, check, Duration::from_secs(seconds))
}

fn run_with_timeout(
    cwd: &Path,
    arguments: &[&str],
    check: bool,
    timeout: Duration,
) -> Result<Output> {
    if interrupted() {
        return Err(Error::new("Interrupted"));
    }
    let mut child = spawn(cwd, arguments)?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let reader = thread::spawn(move || capture(stdout));
    let errors = thread::spawn(move || std::io::copy(&mut { stderr }, &mut std::io::sink()));
    let result = wait(&mut child, &reader, &errors, timeout);
    if result.is_err() {
        terminate_group(&mut child)?;
    }
    let code = result.map_err(|_| Error::new(format!(
        "Could not complete {}: command timed out or was interrupted. Check wt list before retrying.", arguments[0])))?;
    let bytes = reader
        .join()
        .map_err(|_| Error::new("Could not read command output."))??;
    let _ = errors.join();
    let stdout = text::decode(&bytes)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if text::character_count(&stdout) > OUTPUT_LIMIT {
        return Err(Error::new(format!(
            "{} returned too much output; no further action taken.",
            arguments[0]
        )));
    }
    if check && code != 0 {
        return Err(Error::new(format!(
            "{} {} failed (exit {code}). Check repository access and state, then retry.",
            arguments[0], arguments[1]
        )));
    }
    Ok(Output {
        code,
        stdout,
        raw_stdout: bytes,
    })
}

fn spawn(cwd: &Path, arguments: &[&str]) -> Result<Child> {
    if arguments.iter().any(|argument| !text::encodable(argument)) {
        return Err(Error::new(
            "Could not encode command argument; no further action taken.",
        ));
    }
    Command::new(arguments[0])
        .args(arguments[1..].iter().map(|value| text::os(value)))
        .current_dir(cwd)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|error| {
            Error::new(format!(
                "Could not complete {}: {error}. Check wt list before retrying.",
                arguments[0]
            ))
        })
}

fn wait(
    child: &mut Child,
    reader: &JoinHandle<std::io::Result<Vec<u8>>>,
    errors: &JoinHandle<std::io::Result<u64>>,
    timeout: Duration,
) -> Result<i32> {
    let deadline = Instant::now() + timeout;
    loop {
        if interrupted() || Instant::now() >= deadline {
            return Err(Error::new("Interrupted or timed out"));
        }
        if reader.is_finished() && errors.is_finished() && exited_without_reaping(child)? {
            // Preserve the leader's PID until its entire process group is stopped.
            stop_group(child)?;
            let status = child.wait()?;
            use std::os::unix::process::ExitStatusExt;
            return Ok(status
                .code()
                .unwrap_or_else(|| -status.signal().unwrap_or(1)));
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn exited_without_reaping(child: &Child) -> Result<bool> {
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    let result = unsafe {
        libc::waitid(
            libc::P_PID,
            child.id(),
            &mut info,
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    };
    if result == -1 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(info.si_signo == libc::SIGCHLD)
}

fn stop_group(child: &Child) -> Result<()> {
    let group = -(child.id() as i32);
    if unsafe { libc::kill(group, libc::SIGKILL) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error().raw_os_error();
    if error == Some(libc::ESRCH) {
        return Ok(());
    }
    // macOS reports EPERM when only the exited leader remains as a zombie.
    // A leader that is still in the process group must not be treated as stopped.
    if error == Some(libc::EPERM)
        && unsafe { libc::getpgid(child.id() as i32) } == -1
        && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
    {
        return Ok(());
    }
    Err(Error::new(
        "Could not stop command descendants; inspect repository state before retrying.",
    ))
}

fn terminate_group(child: &mut Child) -> Result<()> {
    // Also reap on failed group signaling; never return with an owned leader alive.
    let stopped = stop_group(child);
    let reaped = child.wait();
    stopped?;
    reaped?;
    Ok(())
}

fn capture(mut pipe: impl Read) -> std::io::Result<Vec<u8>> {
    // Four bytes per UTF-8 character suffice to detect the character-count cap.
    // Drain the remainder so the child cannot block on its stdout pipe.
    let mut bytes = Vec::new();
    pipe.by_ref()
        .take((OUTPUT_LIMIT * 4 + 4) as u64)
        .read_to_end(&mut bytes)?;
    std::io::copy(&mut pipe, &mut std::io::sink())?;
    Ok(bytes)
}

#[cfg(test)]
#[path = "../tests/support/process.rs"]
mod tests;
