//! Bounded subprocess ownership. Raw child diagnostics never become CLI errors.
use anyhow::{Context, Result, bail, ensure};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const MAX_OUTPUT: u64 = 16 * 1024 * 1024;
const MAX_DIAGNOSTICS: u64 = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(10);

type Reader = JoinHandle<std::io::Result<Vec<u8>>>;

struct Running {
    child: Child,
    reaped: bool,
}

impl Drop for Running {
    fn drop(&mut self) {
        if !self.reaped {
            // This child owns a new process group. Kill it before reaping its
            // leader so its process-group ID cannot be reused.
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
            let _ = self.child.wait();
        }
    }
}

struct Interrupts {
    stopped: Arc<AtomicBool>,
    registrations: Vec<signal_hook::SigId>,
}

impl Interrupts {
    fn new() -> Result<Self> {
        let mut signals = Self {
            stopped: Arc::new(AtomicBool::new(false)),
            registrations: vec![],
        };
        for signal in [signal_hook::consts::SIGINT, signal_hook::consts::SIGTERM] {
            signals.registrations.push(signal_hook::flag::register(
                signal,
                signals.stopped.clone(),
            )?);
        }
        Ok(signals)
    }
}

impl Drop for Interrupts {
    fn drop(&mut self) {
        for registration in self.registrations.drain(..) {
            signal_hook::low_level::unregister(registration);
        }
    }
}

fn capture(
    pipe: impl Read + Send + 'static,
    limit: u64,
    overflow: Arc<AtomicBool>,
    retain: bool,
) -> Reader {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        pipe.take(limit + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > limit {
            overflow.store(true, Ordering::Relaxed);
        }
        if !retain {
            bytes.clear();
        }
        Ok(bytes)
    })
}

fn wait(
    running: &mut Running,
    stdout: &Reader,
    stderr: &Reader,
    overflow: &AtomicBool,
    signals: &Interrupts,
    seconds: u64,
    accepted: &[i32],
) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        ensure!(
            !signals.stopped.load(Ordering::Relaxed),
            "Reviewer interrupted; no verified result"
        );
        ensure!(
            !overflow.load(Ordering::Relaxed),
            "Reviewer output limit exceeded; no verified result"
        );
        ensure!(
            Instant::now() < deadline,
            "Reviewer timed out; no verified result"
        );
        if stdout.is_finished() && stderr.is_finished() && exited_without_reaping(&running.child)? {
            stop_group(&running.child)?;
            let status = running.child.wait()?;
            running.reaped = true;
            if !status.code().is_some_and(|code| accepted.contains(&code)) {
                bail!("External command failed; no verified result");
            }
            return Ok(());
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
    if error == Some(libc::ESRCH)
        || error == Some(libc::EPERM)
            && unsafe { libc::getpgid(child.id() as i32) } == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
    {
        return Ok(());
    }
    bail!("Cannot stop restricted reviewer descendants; no verified result")
}

pub fn run(command: Command, seconds: u64) -> Result<Vec<u8>> {
    run_accepted(command, seconds, &[0])
}

pub fn run_accepted(mut command: Command, seconds: u64, accepted: &[i32]) -> Result<Vec<u8>> {
    let signals = Interrupts::new()?;
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .context("Cannot start the restricted reviewer")?;
    let mut running = Running {
        child,
        reaped: false,
    };
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = capture(
        running.child.stdout.take().unwrap(),
        MAX_OUTPUT,
        overflow.clone(),
        true,
    );
    let stderr = capture(
        running.child.stderr.take().unwrap(),
        MAX_DIAGNOSTICS,
        overflow.clone(),
        false,
    );
    wait(
        &mut running,
        &stdout,
        &stderr,
        &overflow,
        &signals,
        seconds,
        accepted,
    )?;
    stderr
        .join()
        .map_err(|_| anyhow::anyhow!("Cannot read reviewer diagnostics"))?
        .context("Cannot read reviewer diagnostics")?;
    stdout
        .join()
        .map_err(|_| anyhow::anyhow!("Cannot read reviewer output"))?
        .context("Cannot read reviewer output")
}

#[cfg(test)]
mod tests {
    use super::run;
    use std::{process::Command, thread, time::Duration};

    #[test]
    fn completed_reviewer_stops_redirected_descendants_before_returning() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("late-write");
        let mut command = Command::new("sh");
        command.args([
            "-c",
            "(sleep 0.4; printf late > \"$1\") >/dev/null 2>&1 & exit 0",
            "sh",
            marker.to_str().unwrap(),
        ]);
        assert!(run(command, 2).is_ok());
        thread::sleep(Duration::from_millis(650));
        assert!(
            !marker.exists(),
            "a completed reviewer left a live descendant"
        );
    }

    #[test]
    fn failed_reviewer_stops_redirected_descendants_before_returning() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("late-write");
        let mut command = Command::new("sh");
        command.args([
            "-c",
            "(sleep 0.4; printf late > \"$1\") >/dev/null 2>&1 & exit 7",
            "sh",
            marker.to_str().unwrap(),
        ]);
        assert!(run(command, 2).is_err());
        thread::sleep(Duration::from_millis(650));
        assert!(!marker.exists(), "a failed reviewer left a live descendant");
    }
}
