use crate::paths::{MAX_ARTIFACT, Result};
use std::{
    io::{Read, Write},
    os::{fd::AsRawFd, unix::process::CommandExt},
    path::Path,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    time::{Duration, Instant},
};

pub fn render(request: Vec<u8>, source_directory: &Path) -> Result<Vec<u8>> {
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut child = node(source_directory)?.spawn().map_err(
        |_| "Cannot start Node for bundled Pele. Make the configured Node available on PATH.",
    )?;
    let result = transfer(&mut child, request, deadline);
    // A successful leader can still leave descendants holding input or output pipes.
    stop(&mut child);
    result
}

fn node(source_directory: &Path) -> Result<Command> {
    let mut node = evaluation::change_command::command("node", &[source_directory])
        .map_err(|_| "Cannot find a non-shim Node outside source repositories on an absolute PATH entry. Make the configured Node available directly on PATH.")?;
    node.args([
        "--input-type=module",
        "--eval",
        include_str!("../assets/diagram-worker.mjs"),
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .process_group(0);
    Ok(node)
}

fn stop(child: &mut Child) {
    // SAFETY: spawn created a process group with the child's positive PID as its ID.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.wait();
}

fn nonblocking(stream: &impl AsRawFd) -> Result<()> {
    // SAFETY: the caller owns this pipe; no other thread changes its descriptor flags.
    let flags = unsafe { libc::fcntl(stream.as_raw_fd(), libc::F_GETFL) };
    if flags < 0
        || unsafe { libc::fcntl(stream.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0
    {
        return Err("Cannot bound diagram pipe operations.");
    }
    Ok(())
}

struct Input {
    stream: Option<ChildStdin>,
    bytes: Vec<u8>,
    offset: usize,
}

impl Input {
    fn send(&mut self) -> Result<bool> {
        let Some(stream) = self.stream.as_mut() else {
            return Ok(true);
        };
        if self.offset < self.bytes.len() {
            match stream.write(&self.bytes[self.offset..]) {
                Ok(0) => return Err("Node closed diagram input before it was sent."),
                Ok(count) => self.offset += count,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) =>
                {
                    return Ok(false);
                }
                Err(_) => return Err("Cannot send diagram input to Node."),
            }
        }
        let done = self.offset == self.bytes.len();
        if done {
            self.stream = None;
        }
        Ok(done)
    }
}

fn transfer(child: &mut Child, request: Vec<u8>, deadline: Instant) -> Result<Vec<u8>> {
    let stdin = child.stdin.take().expect("configured stdin pipe");
    let mut output = child.stdout.take().expect("configured stdout pipe");
    nonblocking(&stdin)?;
    nonblocking(&output)?;
    let mut input = Input {
        stream: Some(stdin),
        bytes: request,
        offset: 0,
    };
    let mut bytes = Vec::new();
    loop {
        if Instant::now() >= deadline {
            return Err("Diagram rendering exceeded 30 seconds. Simplify the diagram.");
        }
        let sent = input.send()?;
        let finished = read_available(&mut output, &mut bytes)?;
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "Cannot inspect diagram rendering.")?
        {
            if !status.success() {
                return Err(
                    "Pele could not render the diagram. Check Pele-compatible Mermaid syntax.",
                );
            }
            if sent && finished {
                return (!bytes.is_empty())
                    .then_some(bytes)
                    .ok_or("Pele returned no SVG.");
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn read_available(output: &mut ChildStdout, bytes: &mut Vec<u8>) -> Result<bool> {
    let mut buffer = [0; 65536];
    let finished = match output.read(&mut buffer) {
        Ok(0) => true,
        Ok(count) => {
            bytes.extend_from_slice(&buffer[..count]);
            false
        }
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
            ) =>
        {
            false
        }
        Err(_) => return Err("Cannot read diagram output."),
    };
    if bytes.len() as u64 > MAX_ARTIFACT {
        return Err("Diagram output exceeds the 25 MiB artifact limit. Simplify the diagram.");
    }
    Ok(finished)
}
