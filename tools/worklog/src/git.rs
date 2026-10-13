use crate::error::{Error, Result};
use crate::model::Project;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

const GIT_TIMEOUT: Duration = Duration::from_secs(3);
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const MAX_GIT_OUTPUT: u64 = 8192;

pub fn discover(path: &Path) -> Result<Project> {
    let path = path.canonicalize().map_err(|_| project_error())?;
    let common = git(
        &path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?
    .ok_or_else(project_error)?;
    let common = PathBuf::from(common)
        .canonicalize()
        .map_err(|_| project_error())?;
    let origin = git(
        &path,
        &[
            "config",
            "--local",
            "--no-includes",
            "--get",
            "remote.origin.url",
        ],
    )?;
    match origin {
        Some(origin) => origin_project(&origin, &path, &common),
        None => local_project(&common),
    }
}

fn local_project(common: &Path) -> Result<Project> {
    let display_path = common.to_str().ok_or_else(project_error)?;
    let name_path = if common.file_name().is_some_and(|name| name == ".git") {
        common.parent().ok_or_else(project_error)?
    } else {
        common
    };
    let name = name_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(project_error)?;
    project(
        format!("local:{display_path}"),
        name.trim_end_matches(".git"),
    )
}

fn origin_project(origin: &str, checkout: &Path, common: &Path) -> Result<Project> {
    if origin.contains("://") {
        let url = Url::parse(origin).map_err(|_| origin_error())?;
        return from_url(url, checkout, common);
    }
    if !origin.starts_with(['/', '.']) && origin.contains(':') {
        let (host, path) = origin.split_once(':').ok_or_else(origin_error)?;
        let url = Url::parse(&format!("ssh://{host}/{path}")).map_err(|_| origin_error())?;
        return from_url(url, checkout, common);
    }
    local_origin(Path::new(origin), checkout, common)
}

fn from_url(url: Url, checkout: &Path, common: &Path) -> Result<Project> {
    if url.scheme() == "file" {
        return local_origin(
            &url.to_file_path().map_err(|_| origin_error())?,
            checkout,
            common,
        );
    }
    if !matches!(url.scheme(), "https" | "http" | "ssh" | "git") {
        return Err(origin_error());
    }
    let host = url
        .host_str()
        .ok_or_else(origin_error)?
        .to_ascii_lowercase();
    let port = match (url.scheme(), url.port()) {
        ("ssh", Some(22)) | ("git", Some(9418)) => String::new(),
        (_, Some(port)) => format!(":{port}"),
        _ => String::new(),
    };
    let path = url.path().trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let name = path.rsplit('/').next().ok_or_else(origin_error)?;
    project(format!("origin:{host}{port}/{path}"), name)
}

fn local_origin(path: &Path, checkout: &Path, common: &Path) -> Result<Project> {
    let base = if path.is_absolute() {
        common.to_owned()
    } else {
        checkout_root(checkout, common)?
    };
    let absolute = base.join(path).canonicalize().map_err(|_| origin_error())?;
    let name = absolute
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(origin_error)?;
    project(
        format!("file:{}", absolute.to_str().ok_or_else(origin_error)?),
        name.trim_end_matches(".git"),
    )
}

fn checkout_root(checkout: &Path, common: &Path) -> Result<PathBuf> {
    if git(checkout, &["rev-parse", "--is-bare-repository"])?.as_deref() == Some("true") {
        return Ok(common.to_owned());
    }
    if let Some(setting) = git(
        checkout,
        &[
            "config",
            "--local",
            "--no-includes",
            "--get",
            "core.worktree",
        ],
    )? {
        let primary = common
            .join(setting)
            .canonicalize()
            .map_err(|_| origin_error())?;
        if is_primary_checkout(&primary, common) {
            return Ok(primary);
        }
        return Err(origin_error());
    }
    if common.file_name().is_some_and(|name| name == ".git") {
        let parent = common.parent().ok_or_else(origin_error)?;
        if is_primary_checkout(parent, common) {
            return Ok(parent.to_owned());
        }
    }
    let active = git(
        checkout,
        &["rev-parse", "--path-format=absolute", "--git-dir"],
    )?
    .ok_or_else(origin_error)?;
    if Path::new(&active)
        .canonicalize()
        .map_err(|_| origin_error())?
        != common
    {
        // A separate Git directory without core.worktree does not record its main checkout.
        return Err(origin_error());
    }
    let root = git(checkout, &["rev-parse", "--show-toplevel"])?.ok_or_else(origin_error)?;
    PathBuf::from(root)
        .canonicalize()
        .map_err(|_| origin_error())
}

fn is_primary_checkout(path: &Path, common: &Path) -> bool {
    let Ok(Some(top)) = git(path, &["rev-parse", "--show-toplevel"]) else {
        return false;
    };
    let Ok(Some(git_dir)) = git(path, &["rev-parse", "--path-format=absolute", "--git-dir"]) else {
        return false;
    };
    Path::new(&top).canonicalize().is_ok_and(|top| top == path)
        && Path::new(&git_dir)
            .canonicalize()
            .is_ok_and(|git_dir| git_dir == common)
}

fn project(id: String, name: &str) -> Result<Project> {
    if name.is_empty() || id.len() > MAX_GIT_OUTPUT as usize || id.chars().any(char::is_control) {
        return Err(origin_error());
    }
    Ok(Project {
        id,
        name: name.to_owned(),
    })
}

fn git(path: &Path, args: &[&str]) -> Result<Option<String>> {
    let mut child = Command::new("git")
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(path)
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_COMMON_DIR")
        .env_remove("GIT_CONFIG_COUNT")
        .env_remove("GIT_CONFIG_PARAMETERS")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| project_error())?;
    let stdout = child.stdout.take().ok_or_else(project_error)?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(MAX_GIT_OUTPUT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let status = wait_for_git(&mut child)?;
    let bytes = reader
        .join()
        .map_err(|_| project_error())?
        .map_err(|_| project_error())?;
    if bytes.len() > MAX_GIT_OUTPUT as usize {
        return Err(origin_error());
    }
    if status.code() == Some(1) {
        return Ok(None);
    }
    if !status.success() {
        return Err(project_error());
    }
    let value = String::from_utf8(bytes).map_err(|_| project_error())?;
    Ok(Some(value.trim_end_matches('\n').to_owned()))
}

fn wait_for_git(child: &mut std::process::Child) -> Result<std::process::ExitStatus> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|_| project_error())? {
            return Ok(status);
        }
        if started.elapsed() >= GIT_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(project_error());
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn project_error() -> Error {
    Error::usage(
        "cannot identify a Git project; use --project-path, a known --project, or --unassigned",
    )
}

fn origin_error() -> Error {
    Error::usage("origin cannot form a safe project identity; use a supported Git origin URL")
}
