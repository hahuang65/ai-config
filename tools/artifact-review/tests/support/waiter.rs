use super::support::Review;
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

const EXIT_GUARD: Duration = Duration::from_secs(5);
const EXIT_POLL: Duration = Duration::from_millis(5);

pub struct Waiter {
    child: Child,
    stdout: PathBuf,
    stderr: PathBuf,
}

impl Waiter {
    pub fn new(review: &Review, args: &[&str]) -> Self {
        Self::command(review, "wait", args)
    }

    pub fn bounded(review: &Review) -> Self {
        Self::command(review, "poll", &["--timeout", "1"])
    }

    fn command(review: &Review, operation: &str, args: &[&str]) -> Self {
        let prefix = format!("wait-{:032x}", rand::random::<u128>());
        let stdout = review.root.join(format!("{prefix}.stdout"));
        let stderr = review.root.join(format!("{prefix}.stderr"));
        let child = Command::new(env!("CARGO_BIN_EXE_artifact-review"))
            .arg(operation)
            .arg(&review.file)
            .args(args)
            .env("AR_ROOT", review.root.join("state"))
            .stdin(Stdio::null())
            .stdout(fs::File::create(&stdout).unwrap())
            .stderr(fs::File::create(&stderr).unwrap())
            .spawn()
            .unwrap();
        Self {
            child,
            stdout,
            stderr,
        }
    }

    pub fn running(&mut self) -> bool {
        self.child.try_wait().unwrap().is_none()
    }

    pub fn interrupt(&mut self) {
        assert_eq!(
            unsafe { libc::kill(self.child.id() as i32, libc::SIGINT) },
            0
        );
    }

    fn exit(&mut self) -> std::process::ExitStatus {
        let deadline = Instant::now() + EXIT_GUARD;
        while self.running() {
            assert!(
                Instant::now() < deadline,
                "wait did not return after feedback"
            );
            std::thread::sleep(EXIT_POLL);
        }
        self.child.wait().unwrap()
    }

    pub fn finish(&mut self) -> serde_json::Value {
        assert!(
            self.exit().success(),
            "{}",
            fs::read_to_string(&self.stderr).unwrap()
        );
        serde_json::from_slice(&fs::read(&self.stdout).unwrap()).unwrap()
    }

    pub fn failure(&mut self) -> String {
        assert!(!self.exit().success());
        assert!(fs::read(&self.stdout).unwrap().is_empty());
        fs::read_to_string(&self.stderr).unwrap()
    }
}

impl Drop for Waiter {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
