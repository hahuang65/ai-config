//! Small argparse-compatible surface; parsing finishes before repository access.
use crate::repository::{TASK_ERROR, task_name};

pub struct Arguments {
    pub command: String,
    pub task: Option<String>,
    pub base: Option<String>,
    pub json: bool,
    pub local: bool,
    pub check: bool,
    pub all: bool,
}

pub enum Parse {
    Run(Arguments),
    Exit(i32),
}

pub fn program_name() -> &'static str {
    if std::env::args_os().next().is_some_and(|path| {
        std::path::Path::new(&path).file_name() == Some(std::ffi::OsStr::new("worktree"))
    }) {
        "worktree"
    } else {
        "wt"
    }
}

pub fn usage(command: &str) -> String {
    let suffix = match command {
        "new" => "new [-h] [--json] [--base BASE] [--local] task",
        "enter" => "enter [-h] [--json] task",
        "list" => "list [-h] [--json] [--all]",
        "clean" => "clean [-h] [--json] [--check] [task]",
        _ => "[-h] {new,enter,list,clean} ...",
    };
    format!("usage: {} {suffix}", program_name())
}

fn error(command: &str, message: &str) -> Parse {
    eprintln!("{}", usage(command));
    let program = if command.is_empty() {
        program_name().into()
    } else {
        format!("{} {command}", program_name())
    };
    crate::text::diagnostic(&format!("{program}: error: {message}"));
    Parse::Exit(2)
}

pub fn parse(values: Vec<String>) -> Parse {
    let mut pending = values.into_iter().peekable();
    let mut unknown = Vec::new();
    let command = match command(&mut pending, &mut unknown) {
        Ok(command) => command,
        Err(exit) => return exit,
    };
    let mut args = Arguments {
        command,
        task: None,
        base: None,
        json: false,
        local: false,
        check: false,
        all: false,
    };
    if let Some(exit) = command_arguments(&mut args, &mut pending, &mut unknown) {
        return exit;
    }
    finish(args, unknown)
}

type Pending = std::iter::Peekable<std::vec::IntoIter<String>>;

fn command(pending: &mut Pending, unknown: &mut Vec<String>) -> std::result::Result<String, Parse> {
    loop {
        let Some(value) = pending.next() else {
            return Err(error("", "the following arguments are required: command"));
        };
        if let Some(exit) = help_argument(&value, "") {
            return Err(exit);
        }
        if is_option(&value) && value != "--" {
            unknown.push(value);
            continue;
        }
        if ["new", "enter", "list", "clean"].contains(&value.as_str()) {
            return Ok(value);
        }
        return Err(error(
            "",
            &format!(
                "argument command: invalid choice: {} (choose from 'new', 'enter', 'list', 'clean')",
                quoted(&value)
            ),
        ));
    }
}

fn command_arguments(
    args: &mut Arguments,
    pending: &mut Pending,
    unknown: &mut Vec<String>,
) -> Option<Parse> {
    let mut positional_only = false;
    while let Some(value) = pending.next() {
        if value == "--" && !positional_only {
            positional_only = true;
            if args.command == "list" {
                unknown.push(value);
            }
            continue;
        }
        if positional_only || !is_option(&value) {
            if args.command != "list" && args.task.is_none() {
                if !task_name(&value) {
                    return Some(error(
                        &args.command,
                        &format!("argument task: {TASK_ERROR}"),
                    ));
                }
                args.task = Some(value);
            } else {
                unknown.push(value);
            }
            continue;
        }
        if let Some(exit) = option(args, &value, pending, unknown) {
            return Some(exit);
        }
    }
    None
}

fn finish(args: Arguments, unknown: Vec<String>) -> Parse {
    if ["new", "enter"].contains(&args.command.as_str()) && args.task.is_none() {
        return error(&args.command, "the following arguments are required: task");
    }
    if !unknown.is_empty() {
        return error(
            "",
            &format!("unrecognized arguments: {}", unknown.join(" ")),
        );
    }
    if args
        .base
        .as_ref()
        .is_some_and(|base| base.starts_with('-') || base.chars().any(|ch| ch < ' '))
    {
        return error(
            "",
            "--base must be a revision, not an option or control sequence",
        );
    }
    Parse::Run(args)
}

fn option(
    args: &mut Arguments,
    value: &str,
    pending: &mut Pending,
    unknown: &mut Vec<String>,
) -> Option<Parse> {
    if let Some(exit) = help_argument(value, &args.command) {
        return Some(exit);
    }
    let (name, explicit) = value
        .split_once('=')
        .map_or((value, None), |(name, value)| (name, Some(value)));
    let known = name == "--json"
        || (args.command == "new" && matches!(name, "--base" | "--local"))
        || (args.command == "list" && name == "--all")
        || (args.command == "clean" && name == "--check");
    if !known {
        unknown.push(value.into());
        return None;
    }
    if name == "--base" {
        args.base = match explicit {
            Some(value) => Some(value.into()),
            None if pending.peek().is_some_and(|value| !is_option(value)) => pending.next(),
            _ => {
                return Some(error(
                    &args.command,
                    "argument --base: expected one argument",
                ));
            }
        };
        return None;
    }
    if let Some(explicit) = explicit {
        return Some(error(
            &args.command,
            &format!("argument {name}: ignored explicit argument '{explicit}'"),
        ));
    }
    match name {
        "--json" => args.json = true,
        "--local" => args.local = true,
        "--check" => args.check = true,
        "--all" => args.all = true,
        _ => unreachable!(),
    }
    None
}

fn help_argument(value: &str, command: &str) -> Option<Parse> {
    if value == "--help"
        || value
            .strip_prefix('-')
            .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|ch| ch == 'h'))
    {
        print!("{}", help(command));
        return Some(Parse::Exit(0));
    }
    let explicit = value.strip_prefix("--help=").or_else(|| {
        value
            .strip_prefix("-h")
            .map(|rest| rest.strip_prefix('=').unwrap_or(rest))
    })?;
    Some(error(
        command,
        &format!(
            "argument -h/--help: ignored explicit argument {}",
            quoted(explicit)
        ),
    ))
}

fn quoted(value: &str) -> String {
    let quote = if value.contains('\'') && !value.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            '\\' => escaped.push_str("\\\\"),
            character if character == quote => {
                escaped.push('\\');
                escaped.push(character);
            }
            character if character < ' ' || character == '\u{7f}' => {
                use std::fmt::Write;
                let _ = write!(escaped, "\\x{:02x}", character as u32);
            }
            character => escaped.push(character),
        }
    }
    format!("{quote}{escaped}{quote}")
}

fn is_option(value: &str) -> bool {
    if !value.starts_with('-') || value == "-" {
        return false;
    }
    // argparse treats negative decimal numbers as values, not options.
    let number = &value[1..];
    let negative_number = !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
        || number.split_once('.').is_some_and(|(whole, fraction)| {
            !fraction.is_empty()
                && whole.bytes().all(|byte| byte.is_ascii_digit())
                && fraction.bytes().all(|byte| byte.is_ascii_digit())
        });
    !negative_number
}

pub fn help(command: &str) -> String {
    let body = match command {
        "new" => {
            "\npositional arguments:\n  task\n\noptions:\n  -h, --help   show this help message and exit\n  --json       Emit protocol version 1 JSON; diagnostics stay on stderr\n  --base BASE  Explicit starting revision (does not change the integration\n               target)\n  --local      Use local history without fetching\n"
        }
        "enter" => {
            "\npositional arguments:\n  task\n\noptions:\n  -h, --help  show this help message and exit\n  --json      Emit protocol version 1 JSON; diagnostics stay on stderr\n"
        }
        "list" => {
            "\noptions:\n  -h, --help  show this help message and exit\n  --json      Emit protocol version 1 JSON; diagnostics stay on stderr\n  --all       Show every worktree instead of the first 50\n"
        }
        "clean" => {
            "\npositional arguments:\n  task\n\noptions:\n  -h, --help  show this help message and exit\n  --json      Emit protocol version 1 JSON; diagnostics stay on stderr\n  --check     Check safety without removing anything\n"
        }
        _ => {
            "\nCreate, resume, and safely remove task worktrees. Never commits or publishes.\n\npositional arguments:\n  {new,enter,list,clean}\n    new                 Create a task branch and worktree\n    enter               Print an existing task's path\n    list                List this project's worktrees without network access\n    clean               Remove integrated, clean tasks; ignored files are\n                        disposable\n\noptions:\n  -h, --help            show this help message and exit\n"
        }
    };
    let completion = if command.is_empty() {
        "\nBash completion (Rust CLI): wt completions bash; shell: wt shell-init bash\n"
    } else {
        ""
    };
    format!("{}\n{body}{completion}", usage(command))
}
