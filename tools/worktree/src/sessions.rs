//! Harness-specific conversation references, without session claims or locks.
//! Transcripts remain harness-owned; this module never reads or converts them.
use crate::{Error, Result, git, records::Entry, repository::Repository, text};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

const HELP: &str = "usage: wt session ACTION TASK --harness pi|claude [--conversation ID]\n\nActions: inspect, bind, verify. Output is always JSON.\nUse wt session locate --harness HARNESS --conversation ID to find a binding.\nbind and verify require the actual task working directory.\nBindings are saved conversation references, not exclusive session claims.\nExisting bindings cannot be replaced. No worktree locks are acquired or released.\n";

struct Request {
    action: String,
    task: String,
    harness: String,
    conversation: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    version: u8,
    common: String,
    path: String,
    branch: String,
    harness: String,
    conversation: String,
}

pub fn main(args: &[String]) -> Result<i32> {
    if args.is_empty() || args == ["--help"] || args == ["-h"] {
        print!("{HELP}");
        return Ok(0);
    }
    let request = match parse(args) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("{HELP}\n{error}");
            return Ok(2);
        }
    };
    let cwd = std::env::current_dir()?;
    if request.action == "locate" {
        let result = json!({"protocolVersion": 1, "command": "session", "action": "locate",
            "worktree": locate(&cwd, &request)?.map(|entry| entry.identity())});
        println!("{}", text::ascii_json(&result.to_string()));
    } else {
        execute(&Repository::new(&cwd)?, &request)?;
    }
    Ok(0)
}

fn parse(args: &[String]) -> Result<Request> {
    let locate = args.first().is_some_and(|arg| arg == "locate");
    if args.len() < 4 || !["locate", "inspect", "bind", "verify"].contains(&args[0].as_str()) {
        return Err(Error::new("Choose a session action and task."));
    }
    let mut options = HashMap::new();
    for pair in args[if locate { 1 } else { 2 }..].chunks(2) {
        if pair.len() != 2
            || !["--harness", "--conversation"].contains(&pair[0].as_str())
            || options.insert(pair[0].as_str(), pair[1].clone()).is_some()
            || pair[1].is_empty()
            || pair[1].len() > 4096
            || pair[1].chars().any(char::is_control)
        {
            return Err(Error::new("Invalid or repeated session option."));
        }
    }
    let harness = options.remove("--harness").unwrap_or_default();
    let conversation = options.remove("--conversation");
    if !["pi", "claude"].contains(&harness.as_str())
        || (["bind", "verify", "locate"].contains(&args[0].as_str()) && conversation.is_none())
    {
        return Err(Error::new(
            "Supply a harness and a conversation for bind/verify/locate.",
        ));
    }
    Ok(Request {
        action: args[0].clone(),
        task: if locate {
            String::new()
        } else {
            args[1].clone()
        },
        harness,
        conversation,
    })
}

fn binding_path(entry: &Entry, harness: &str) -> Result<PathBuf> {
    git::path(
        &text::pathbuf(&entry.path),
        &format!("wt-session-{harness}.json"),
    )
}

fn read_record(path: &Path) -> Result<Option<Binding>> {
    if path.is_symlink() {
        return Err(Error::new(
            "Conversation binding is a symlink; inspect it manually.",
        ));
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| Error::new("Invalid conversation binding; inspect it manually."))
}

fn read_binding(repo: &Repository, entry: &Entry, request: &Request) -> Result<Option<Binding>> {
    let Some(binding) = read_record(&binding_path(entry, &request.harness)?)? else {
        return Ok(None);
    };
    if binding.version != 1
        || binding.common != text::path(&repo.common)
        || binding.path != entry.path
        || binding.branch != entry.branch
        || binding.harness != request.harness
        || binding.conversation.is_empty()
    {
        return Err(Error::new(
            "Conversation binding does not match this repository and task.",
        ));
    }
    Ok(Some(binding))
}

fn lookup_record(path: &Path) -> Option<Binding> {
    match read_record(path) {
        Ok(binding) => binding,
        Err(_) => {
            // Discovery cannot attribute an unreadable record to a conversation.
            // Direct inspect/bind/verify still reject it instead of replacing it.
            text::diagnostic(&format!(
                "wt: Skipped unreadable conversation reference {}. Inspect that task's saved reference before resuming it.",
                text::path(path)
            ));
            None
        }
    }
}

fn locate(cwd: &Path, request: &Request) -> Result<Option<Entry>> {
    let mut found = None;
    // Finding a saved reference is not a request to create or acquire a task.
    for item in git::inventory(cwd)? {
        let path = text::pathbuf(&item["worktree"]);
        if !path.is_dir() {
            continue;
        }
        let record = git::path(&path, &format!("wt-session-{}.json", request.harness))?;
        let Some(binding) = lookup_record(&record) else {
            continue;
        };
        if Some(&binding.conversation) != request.conversation.as_ref() {
            continue;
        }
        if found.is_some() {
            return Err(Error::new(
                "Conversation is bound to multiple tasks; inspect it manually.",
            ));
        }
        let repo = Repository::new(cwd)?;
        let metadata = repo
            .metadata(&path)?
            .ok_or_else(|| Error::new("Saved conversation's task metadata is invalid."))?;
        let entry = repo.selected(&metadata.task)?;
        read_binding(&repo, &entry, request)?;
        found = Some(entry);
    }
    Ok(found)
}

fn execute(repo: &Repository, request: &Request) -> Result<()> {
    let entry = repo.selected(&request.task)?;
    let mut binding = read_binding(repo, &entry, request)?;
    if request.action != "inspect" {
        if let (Some(saved), Some(wanted)) = (&binding, &request.conversation)
            && saved.conversation != *wanted
        {
            return Err(Error::new(
                "Resume the saved task conversation instead of replacing it.",
            ));
        }
        bind_or_verify(repo, &entry, request, &mut binding)?;
    }
    let result = json!({"protocolVersion": 1, "command": "session", "action": request.action,
        "project": repo.summary(), "worktree": entry.identity(), "harness": request.harness,
        "conversation": binding.map(|saved| saved.conversation)});
    println!("{}", text::ascii_json(&result.to_string()));
    Ok(())
}

fn bind_or_verify(
    repo: &Repository,
    entry: &Entry,
    request: &Request,
    binding: &mut Option<Binding>,
) -> Result<()> {
    if repo.cwd != text::pathbuf(&entry.path) {
        return Err(Error::new(
            "The harness working directory is not the task root. Complete the native transition first.",
        ));
    }
    if request.action == "bind" && binding.is_none() {
        if locate(&repo.cwd, request)?.is_some() {
            return Err(Error::new(
                "Conversation already belongs to another task. Fork it through the native harness first.",
            ));
        }
        let saved = Binding {
            version: 1,
            common: text::path(&repo.common),
            path: entry.path.clone(),
            branch: entry.branch.clone(),
            harness: request.harness.clone(),
            conversation: request
                .conversation
                .clone()
                .expect("validated conversation"),
        };
        let path = binding_path(entry, &request.harness)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
        file.write_all(
            serde_json::to_string(&saved)
                .expect("binding JSON")
                .as_bytes(),
        )?;
        file.sync_all()?;
        *binding = Some(saved);
    }
    if binding.is_none() {
        return Err(Error::new(
            "No saved task conversation. Bind it after the native transition.",
        ));
    }
    Ok(())
}
