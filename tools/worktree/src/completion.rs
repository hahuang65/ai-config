//! Opt-in Bash integration/completion setup and quiet, read-only completion requests.
use crate::{Result, repository::Repository};
use std::io::Write;

pub fn dispatch(values: &[String]) -> Option<Result<i32>> {
    match values.first()?.as_str() {
        "completions" => Some(setup(
            &values[1..],
            "completions",
            "Print Bash completion setup for wt and worktree.",
            include_bytes!("completion.bash"),
        )),
        "shell-init" => Some(setup(
            &values[1..],
            "shell-init",
            "Print opt-in Bash directory switching for wt and worktree.",
            include_bytes!("shell.bash"),
        )),
        "__complete" => Some(request(&values[1..])),
        _ => None,
    }
}

fn setup(values: &[String], command: &str, description: &str, script: &[u8]) -> Result<i32> {
    if values
        .iter()
        .any(|value| matches!(value.as_str(), "-h" | "--help"))
    {
        println!(
            "Usage: {} {command} bash\n\n{description} No installation is performed.",
            crate::args::program_name()
        );
        return Ok(0);
    }
    match values {
        [shell] if shell == "bash" => {
            std::io::stdout().write_all(script)?;
            Ok(0)
        }
        _ => {
            eprintln!(
                "Usage: {} {command} bash\nOnly Bash is supported. Source the output to enable this integration.",
                crate::args::program_name()
            );
            Ok(2)
        }
    }
}

fn request(values: &[String]) -> Result<i32> {
    if values.len() > 256 || values.iter().map(String::len).sum::<usize>() > 32 * 1024 {
        return Ok(0);
    }
    let Some(index) = values.first().and_then(|value| value.parse::<usize>().ok()) else {
        return Ok(0);
    };
    let words = &values[1..];
    let Some(current) = words.get(index) else {
        return Ok(0);
    };
    crate::process::install_interrupt_handler()?;
    for candidate in candidates(words, index, current) {
        if candidate.starts_with(current) {
            writeln!(std::io::stdout(), "{candidate}")?;
        }
    }
    Ok(0)
}

fn candidates(words: &[String], index: usize, current: &str) -> Vec<String> {
    if index == 1 {
        return ["new", "enter", "list", "clean", "completions", "shell-init"]
            .map(str::to_owned)
            .to_vec();
    }
    if index < 2 {
        return Vec::new();
    }
    let command = &words[1];
    let prior = &words[2..index];
    let Some(position) = position(command, prior) else {
        return Vec::new();
    };
    let mut values = Vec::new();
    if !position.task && !current.starts_with('-') {
        if matches!(command.as_str(), "enter" | "clean") {
            values.extend(tasks().unwrap_or_default());
        }
        if matches!(command.as_str(), "completions" | "shell-init") {
            values.push("bash".into());
        }
    }
    values.sort();
    values.dedup();
    values
}

#[derive(Default)]
struct Position {
    positional: bool,
    task: bool,
}

fn position(command: &str, prior: &[String]) -> Option<Position> {
    if options(command).is_empty() {
        return None;
    }
    let mut position = Position::default();
    let mut base = false;
    for word in prior {
        if base {
            // Bash can split --base=main into --base, =, main.
            base = word == "=";
            continue;
        }
        match word.as_str() {
            "--" if !position.positional => position.positional = true,
            "-h" | "--help" if !position.positional => return None,
            "--base" if !position.positional && command == "new" => base = true,
            value if !position.positional && command == "new" && value.starts_with("--base=") => {}
            value if !position.positional && options(command).contains(&value) => {}
            value if !position.positional && value.starts_with('-') => return None,
            _ => {
                if position.task || command == "list" {
                    return None;
                }
                position.task = true;
            }
        }
    }
    (!base).then_some(position)
}

fn options(command: &str) -> &'static [&'static str] {
    match command {
        "new" => &["-h", "--help", "--json", "--base", "--local"],
        "enter" => &["-h", "--help", "--json"],
        "list" => &["-h", "--help", "--json", "--all"],
        "clean" => &["-h", "--help", "--json", "--check"],
        "completions" | "shell-init" => &["-h", "--help"],
        _ => &[],
    }
}

fn tasks() -> Result<Vec<String>> {
    let repo = Repository::new(&std::env::current_dir()?)?;
    let mut names: Vec<_> = repo
        .entries()?
        .into_iter()
        .filter(|entry| entry.managed)
        .map(|entry| entry.task)
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}
