//! Bounded subprocess ownership. Raw child diagnostics never become CLI errors.
use crate::reviewer_diagnostics::{Category, Failure, ProcessEvidence};
use anyhow::{Context, Result, bail, ensure};
use std::io::Read;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const MAX_OUTPUT: u64 = 16 * 1024 * 1024;
const MAX_DIAGNOSTICS: u64 = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(10);

struct Reader {
    task: JoinHandle<std::io::Result<Vec<u8>>>,
    count: Arc<AtomicU64>,
}

fn evidence(
    mut process: ProcessEvidence,
    stdout: &AtomicU64,
    stderr: &AtomicU64,
) -> ProcessEvidence {
    process.stdout_bytes = Some(stdout.load(Ordering::Relaxed));
    process.stderr_bytes = Some(stderr.load(Ordering::Relaxed));
    process
}

pub(crate) struct Output {
    pub bytes: Vec<u8>,
    pub evidence: ProcessEvidence,
}

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

fn capture(pipe: impl Read + Send + 'static, limit: u64, retain: bool) -> Reader {
    let count = Arc::new(AtomicU64::new(0));
    let observed = count.clone();
    let task = thread::spawn(move || {
        let mut pipe = pipe.take(limit + 1);
        let mut bytes = Vec::new();
        let mut buffer = [0; 8192];
        loop {
            let size = match pipe.read(&mut buffer) {
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                result => result?,
            };
            if size == 0 {
                break;
            }
            observed.fetch_add(size as u64, Ordering::Relaxed);
            if retain {
                bytes.extend_from_slice(&buffer[..size]);
            }
        }
        Ok(bytes)
    });
    Reader { task, count }
}

fn check_limits(output: bool, diagnostics: bool) -> Result<()> {
    if output {
        let mut failure = Failure::new(Category::EventStreamLimit, None);
        failure.process.stdout_bytes = Some(MAX_OUTPUT + 1);
        return Err(failure.into());
    }
    if diagnostics {
        let mut failure = Failure::new(Category::StderrLimit, None);
        failure.process.stderr_bytes = Some(MAX_DIAGNOSTICS + 1);
        return Err(failure.into());
    }
    Ok(())
}

fn wait(
    running: &mut Running,
    stdout: &Reader,
    stderr: &Reader,
    signals: &Interrupts,
    seconds: u64,
    process: &mut ProcessEvidence,
) -> Result<ExitStatus> {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        let exited = observe_exit(&running.child, process)?;
        if signals.stopped.load(Ordering::Relaxed) {
            return Err(Failure::new(Category::ProcessInterrupted, None).into());
        }
        check_limits(
            stdout.count.load(Ordering::Relaxed) > MAX_OUTPUT,
            stderr.count.load(Ordering::Relaxed) > MAX_DIAGNOSTICS,
        )?;
        if Instant::now() >= deadline {
            return Err(Failure::new(Category::ProcessTimeout, None).into());
        }
        if stdout.task.is_finished() && stderr.task.is_finished() && exited {
            stop_group(&running.child)?;
            let status = running.child.wait()?;
            running.reaped = true;
            return Ok(status);
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn observe_exit(child: &Child, process: &mut ProcessEvidence) -> Result<bool> {
    if process.exit_code.is_some() || process.signal.is_some() {
        return Ok(true);
    }
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
    if info.si_signo != libc::SIGCHLD {
        return Ok(false);
    }
    // WEXITED identifies the status union; WNOWAIT keeps the leader's PID
    // reserved until its descendants have been stopped.
    let status = unsafe { info.si_status() };
    match info.si_code {
        libc::CLD_EXITED => process.exit_code = Some(status),
        libc::CLD_KILLED | libc::CLD_DUMPED => process.signal = Some(status),
        _ => bail!("Cannot observe reviewer termination"),
    }
    Ok(true)
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

pub fn run_accepted(command: Command, seconds: u64, accepted: &[i32]) -> Result<Vec<u8>> {
    let output = run_captured(command, seconds)?;
    ensure!(
        output
            .evidence
            .exit_code
            .is_some_and(|code| accepted.contains(&code)),
        "External command failed; no verified result"
    );
    Ok(output.bytes)
}

pub(crate) fn run_captured(mut command: Command, seconds: u64) -> Result<Output> {
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
    let stdout = capture(running.child.stdout.take().unwrap(), MAX_OUTPUT, true);
    let stderr = capture(running.child.stderr.take().unwrap(), MAX_DIAGNOSTICS, false);
    let mut process = ProcessEvidence::default();
    let status = wait(
        &mut running,
        &stdout,
        &stderr,
        &signals,
        seconds,
        &mut process,
    )
    .map_err(|error| Failure::capture(error, evidence(process, &stdout.count, &stderr.count)))?;
    collected(status, stdout, stderr)
}

fn collected(status: ExitStatus, stdout: Reader, stderr: Reader) -> Result<Output> {
    let result = (|| {
        stderr
            .task
            .join()
            .map_err(|_| anyhow::anyhow!("Cannot read reviewer diagnostics"))?
            .context("Cannot read reviewer diagnostics")?;
        let bytes = stdout
            .task
            .join()
            .map_err(|_| anyhow::anyhow!("Cannot read reviewer output"))?
            .context("Cannot read reviewer output")?;
        Ok(bytes)
    })();
    let evidence = evidence(
        ProcessEvidence {
            exit_code: status.code(),
            signal: status.signal(),
            ..Default::default()
        },
        &stdout.count,
        &stderr.count,
    );
    let result = result.and_then(|bytes| {
        // Recheck after joining: completion can race the loop's limit check.
        check_limits(
            evidence.stdout_bytes.unwrap() > MAX_OUTPUT,
            evidence.stderr_bytes.unwrap() > MAX_DIAGNOSTICS,
        )?;
        Ok(bytes)
    });
    match result {
        Ok(bytes) => Ok(Output { bytes, evidence }),
        Err(error) => Err(Failure::capture(error, evidence)),
    }
}

#[cfg(test)]
#[path = "../tests/support/reviewer_process.rs"]
mod tests;
