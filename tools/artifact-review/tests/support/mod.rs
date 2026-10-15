use reqwest::blocking::Client;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    os::unix::fs::DirBuilderExt,
    path::PathBuf,
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};

const COMMAND_GUARD: Duration = Duration::from_secs(15);
const COMMAND_POLL: Duration = Duration::from_millis(5);
const HTTP_GUARD: Duration = Duration::from_secs(5);

pub struct Review {
    pub root: PathBuf,
    pub file: PathBuf,
    pub record: PathBuf,
}

impl Review {
    pub fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("finding-review-{:032x}", rand::random::<u128>()));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let file = root.join("report.html");
        let record = root.join("report.json");
        let html = "<html><body><article id=\"F1\"><h4>F1 · First</h4></article><article id=\"F2\"><h4>F2 · Second</h4></article></body></html>";
        fs::write(&file, html).unwrap();
        fs::write(
            &record,
            json!({"version":1,"html_digest":format!("{:x}", Sha256::digest(html)),
            "findings":[{"id":"F1","title":"First"},{"id":"F2","title":"Second"}]})
            .to_string(),
        )
        .unwrap();
        Self { root, file, record }
    }

    pub fn command(&self, args: &[&str]) -> Output {
        let stdout = self.root.join("stdout");
        let stderr = self.root.join("stderr");
        let mut child = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
            .args(args)
            .env("AR_ROOT", self.root.join("state"))
            .stdin(Stdio::null())
            .stdout(fs::File::create(&stdout).unwrap())
            .stderr(fs::File::create(&stderr).unwrap())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + COMMAND_GUARD;
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("review-artifact exceeded COMMAND_GUARD");
            }
            std::thread::sleep(COMMAND_POLL);
        };
        Output {
            status,
            stdout: fs::read(stdout).unwrap(),
            stderr: fs::read(stderr).unwrap(),
        }
    }

    pub fn open(&self) -> Output {
        self.command(&[
            "open",
            self.file.to_str().unwrap(),
            "--findings",
            self.record.to_str().unwrap(),
            "--no-browser",
        ])
    }

    pub fn poll(&self) -> Value {
        let output = self.command(&["poll", self.file.to_str().unwrap(), "--timeout", "0"]);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }

    pub fn submit(
        &self,
        action: &str,
        finding: &str,
        revision: &str,
    ) -> reqwest::blocking::Response {
        self.submit_payload(
            &json!({"id":format!("decision-{:032x}",rand::random::<u128>()),"action":action,
            "finding":finding,"revision":revision,"message":"My decision","annotations":[]}),
        )
    }

    pub fn submit_payload(&self, payload: &Value) -> reqwest::blocking::Response {
        self.request("/submit", Some(payload))
    }

    pub fn request(&self, route: &str, payload: Option<&Value>) -> reqwest::blocking::Response {
        let directory = fs::read_dir(self.root.join("state"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let descriptor: Value =
            serde_json::from_slice(&fs::read(directory.join("server.json")).unwrap()).unwrap();
        let origin = format!("http://127.0.0.1:{}", descriptor["port"]);
        let client = Client::builder()
            .no_proxy()
            .timeout(HTTP_GUARD)
            .build()
            .unwrap();
        let url = format!("{origin}{route}");
        let request = match payload {
            Some(payload) => client.post(url).json(payload),
            None => client.get(url),
        };
        request
            .header("Origin", &origin)
            .bearer_auth(descriptor["capability"].as_str().unwrap())
            .send()
            .unwrap()
    }
}

impl Drop for Review {
    fn drop(&mut self) {
        let _ = self.command(&["stop", self.file.to_str().unwrap()]);
        let _ = fs::remove_dir_all(&self.root);
    }
}
