use anyhow::{Context, Result};
use std::{fs, os::unix::fs::PermissionsExt, path::Path, process::Command};

pub fn command(name: &str, excluded: &[&Path]) -> Result<Command> {
    let excluded: Vec<_> = excluded
        .iter()
        .map(|path| {
            path.ancestors()
                .find(|path| fs::symlink_metadata(path.join(".git")).is_ok())
                .unwrap_or(path)
        })
        .collect();
    let directories: Vec<_> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .filter(|directory| directory.is_absolute())
        .filter_map(|directory| directory.canonicalize().ok())
        .filter(|directory| {
            directory.is_dir() && !excluded.iter().any(|root| directory.starts_with(root))
        })
        .collect();
    let executable = directories
        .iter()
        .filter_map(|directory| directory.join(name).canonicalize().ok())
        .find(|path| {
            !excluded.iter().any(|root| path.starts_with(root))
                && fs::metadata(path)
                    .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
        .with_context(|| {
            format!("Cannot find {name} outside reviewed source on an absolute PATH entry")
        })?;
    let mut command = Command::new(executable);
    command.env("PATH", std::env::join_paths(directories)?);
    clean_startup(&mut command);
    command.current_dir(std::env::temp_dir());
    Ok(command)
}

fn clean_startup(command: &mut Command) {
    for key in [
        "NODE_OPTIONS",
        "NODE_PATH",
        "PI_CODING_AGENT_SESSION_DIR",
        "BASH_ENV",
        "ENV",
        "ZDOTDIR",
        "CDPATH",
    ] {
        command.env_remove(key);
    }
    for (key, _) in std::env::vars_os() {
        if key
            .to_str()
            .is_some_and(|key| key.starts_with("GIT_") || key.starts_with("BASH_FUNC_"))
        {
            command.env_remove(key);
        }
    }
}
