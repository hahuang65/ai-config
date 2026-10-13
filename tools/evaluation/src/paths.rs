use anyhow::{Context, Result, ensure};
use std::env;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

pub struct Paths {
    pub root: PathBuf,
    pub source: PathBuf,
    pub home: PathBuf,
    pub state: PathBuf,
    pub profile: PathBuf,
    pub executable: PathBuf,
}

impl Paths {
    pub fn new(root: Option<PathBuf>) -> Result<Self> {
        let executable = env::current_exe()?.canonicalize()?;
        let root = match root {
            Some(root) => root
                .canonicalize()
                .context("Cannot resolve evaluation root")?,
            None => executable_root(&executable)
                .context("Cannot locate standalone root; use --root PATH")?
                .to_owned(),
        };
        let home =
            PathBuf::from(env::var("HOME").context("HOME must be an absolute non-root directory")?);
        ensure!(
            home.is_absolute()
                && home
                    .components()
                    .any(|part| matches!(part, Component::Normal(_)))
                && home.to_str().is_some_and(is_text),
            "HOME must be an absolute non-root directory"
        );
        // Normalize lexical dot components without following destination symlinks.
        let home = normalize(&home);
        ensure!(
            home != Path::new("/"),
            "HOME must be an absolute non-root directory"
        );
        let source = root.clone();
        let state = home.join(".local/state/ai-config");
        let profile = state.join("reviewer-pi");
        Ok(Self {
            root,
            source,
            home,
            state,
            profile,
            executable,
        })
    }
}

fn executable_root(executable: &Path) -> Option<&Path> {
    executable
        .ancestors()
        .find(|path| path.join("manifest.json").is_file() && path.join("reviewer.md").is_file())
}

fn normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            component => normalized.push(component),
        }
    }
    normalized
}

pub fn is_text(value: &str) -> bool {
    !value.trim_matches(|c| matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')).is_empty()
        && !value.chars().any(|c| c <= '\u{001f}')
}

pub fn present(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub fn real_directory(path: &Path) -> Result<()> {
    if present(path)? {
        ensure!(
            fs::symlink_metadata(path)?.is_dir(),
            "Refusing non-directory or symlink destination: {}",
            path.display()
        );
    }
    Ok(())
}
