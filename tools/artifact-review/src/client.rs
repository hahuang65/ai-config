use crate::model::{Page, Submission};
use crate::paths::{Descriptor, Paths, Result};
use reqwest::blocking::Client;
use serde_json::{Value, json};
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const CONNECT_WAIT: Duration = Duration::from_secs(10);
const TICK: Duration = Duration::from_millis(100);

pub struct Session {
    client: Client,
    descriptor: Descriptor,
}

impl Session {
    pub fn connect(paths: &Paths) -> Result<Self> {
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Cannot start local client.")?;
        Ok(Self {
            client,
            descriptor: paths.descriptor()?,
        })
    }

    fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.descriptor.port)
    }

    pub fn request(&self, route: &str, body: Option<&Value>) -> Result<Value> {
        let url = format!("{}{route}", self.origin());
        let request = match body {
            Some(body) => self.client.post(url).json(body),
            None => self.client.get(url),
        };
        let response = request.bearer_auth(&self.descriptor.capability).header("Origin", self.origin())
            .send().map_err(|_| "Local review unavailable. Use open FILE to reconnect; reuse your cursor and reply ID.")?;
        decode_response(response)
    }

    fn events(&self, cursor: u64, wait: Duration) -> Result<Option<Value>> {
        let url = format!(
            "{}/events?cursor={cursor}&wait_ms={}",
            self.origin(),
            wait.as_millis()
        );
        let response = self
            .client
            .get(url)
            .bearer_auth(&self.descriptor.capability)
            .header("Origin", self.origin())
            .timeout(wait + Duration::from_secs(3))
            .send();
        match response {
            Ok(response) if !response.status().is_success() => decode_response(response).map(Some),
            Ok(response) => match response.json() {
                Ok(value) => Ok(Some(value)),
                Err(error) if error.is_timeout() && !wait.is_zero() => Ok(None),
                Err(_) => Err("Invalid local review response."),
            },
            // A bounded connection timeout is not an end to the logical foreground wait.
            Err(error) if error.is_timeout() && !wait.is_zero() => Ok(None),
            Err(_) => Err(
                "Local review unavailable. Use open FILE to reconnect; reuse your cursor and reply ID.",
            ),
        }
    }

    fn browse(&self, paths: &Paths, binding: Option<&crate::findings::Binding>) -> Result<()> {
        let url = format!("{}/#{}", self.origin(), self.descriptor.capability);
        let opener = if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        };
        let roots = match binding {
            Some(binding) => evaluation::publication::source_context(
                &paths.artifact,
                &binding.report_digest,
                &binding.revision,
            )
            .map_err(|_| "Cannot restore the retained report's source exclusions.")?,
            None => vec![],
        };
        let parent = paths
            .artifact
            .parent()
            .ok_or("Artifact has no directory.")?;
        let mut child = evaluation::change_command::with_sources(&roots, || {
            evaluation::change_command::command(opener, &[parent])
        })
        .map_err(|_| "Cannot find a browser opener outside reviewed source.")?
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Cannot open browser. Review server remains available.")?;
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(Some(_)) | Err(_) => {
                    return Err("Browser opener failed. Review server remains available.");
                }
                Ok(None) => std::thread::sleep(TICK),
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        Err("Browser opener timed out. Review server remains available.")
    }
}

pub fn open(
    paths: &Paths,
    no_browser: bool,
    binding: Option<&crate::findings::Binding>,
) -> Result<Value> {
    paths.read_artifact()?;
    if let Some(binding) = binding
        && crate::model::revision(paths)? != binding.revision
    {
        return Err("Findings report does not match the artifact revision.");
    }
    let session = match Session::connect(paths).and_then(|session| {
        session.request("/events?cursor=0", None)?;
        Ok(session)
    }) {
        Ok(session) => session,
        Err(_) => start(paths)?,
    };
    if let Some(binding) = binding {
        session.request(
            "/findings",
            Some(&serde_json::to_value(binding).map_err(|_| "Cannot encode findings.")?),
        )?;
    }
    let standalone = binding.is_some_and(|binding| binding.read_only);
    if standalone {
        session.request("/feedback/standalone", Some(&json!({})))?;
    }
    session.request("/reopen", Some(&json!({})))?;
    if !no_browser {
        session.browse(paths, binding)?;
    }
    let state = session.request("/events?cursor=0", None)?;
    if standalone {
        return Ok(json!({"status":state["status"],"browser":!no_browser}));
    }
    let ticket = session.request("/feedback/ticket", Some(&json!({})))?;
    Ok(json!({"status": state["status"], "browser": !no_browser,
        "review_feedback":{"version":1,"artifact":paths.artifact,"ticket":ticket["ticket"]}}))
}

fn start(paths: &Paths) -> Result<Session> {
    let mut command =
        Command::new(std::env::current_exe().map_err(|_| "Cannot find review executable.")?);
    command
        .arg("_serve")
        .arg(&paths.artifact)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // The tracked server owns its lifetime independently of a foreground poll.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = command.spawn().map_err(|_| "Cannot start review server.")?;
    let deadline = Instant::now() + CONNECT_WAIT;
    while Instant::now() < deadline {
        if let Ok(session) = Session::connect(paths)
            && session.request("/events?cursor=0", None).is_ok()
        {
            return Ok(session);
        }
        std::thread::sleep(TICK);
    }
    let _ = child.kill();
    let _ = child.wait();
    Err("Review server did not start within 10 seconds.")
}

pub fn poll(
    paths: &Paths,
    cursor: u64,
    timeout: Option<u64>,
    reply: Option<(String, String)>,
) -> Result<Value> {
    let session = Session::connect(paths)?;
    if let Some((message, id)) = reply {
        let submission = Submission {
            id,
            message,
            action: "reply".into(),
            revision: String::new(),
            annotations: vec![],
            finding: None,
        };
        session.request(
            "/submit",
            Some(&serde_json::to_value(submission).map_err(|_| "Cannot encode reply.")?),
        )?;
    }
    let deadline = timeout.map(|seconds| Instant::now() + Duration::from_secs(seconds));
    loop {
        let maximum = Duration::from_millis(crate::event_wait::MAX_WAIT_MS);
        let wait = deadline.map_or(maximum, |deadline| {
            maximum.min(deadline.saturating_duration_since(Instant::now()))
        });
        let Some(response) = session.events(cursor, wait)? else {
            continue;
        };
        let page: Page =
            serde_json::from_value(response.clone()).map_err(|_| "Invalid event page.")?;
        if !page.events.is_empty()
            || page.status != "open"
            || deadline.is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Ok(response);
        }
    }
}

fn decode_response(response: reqwest::blocking::Response) -> Result<Value> {
    if !response.status().is_success() {
        return Err(
            "Local review rejected the request. Check the cursor, reply ID, and review state.",
        );
    }
    response
        .json()
        .map_err(|_| "Invalid local review response.")
}

pub fn stop(paths: &Paths) -> Result<Value> {
    let session = Session::connect(paths)?;
    session.request("/stop", Some(&json!({})))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while paths.directory.join("server.json").exists() && Instant::now() < deadline {
        std::thread::sleep(TICK);
    }
    if paths.directory.join("server.json").exists() {
        return Err("Server shutdown is not confirmed.");
    }
    Ok(json!({"status": "stopped"}))
}
