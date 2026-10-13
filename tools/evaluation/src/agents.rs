//! Explicit read-only roles; neither repository nor global agent discovery is used.
use crate::paths::{Paths, real_directory};
use anyhow::{Result, ensure};
use std::{fs, path::PathBuf};

pub const NAMES: [&str; 5] = [
    "api-designer",
    "frontend-architect",
    "database-reviewer",
    "fact-checker",
    "change-reviewer",
];

pub fn path(paths: &Paths, name: &str) -> Result<PathBuf> {
    ensure!(NAMES.contains(&name), "Unknown read-only specialist");
    let directory = paths.source.join("agents");
    real_directory(&directory)?;
    let path = directory.join(format!("{name}.md"));
    ensure!(
        fs::symlink_metadata(&path).is_ok_and(|meta| meta.is_file()),
        "Required specialist definition is missing or linked: {name}"
    );
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reviewer_role_comes_only_from_the_root_source() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let legacy = root.join("legacy/agents/change-reviewer.md");
        let native = root.join("agents/change-reviewer.md");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::create_dir_all(native.parent().unwrap()).unwrap();
        fs::write(&legacy, "obsolete review contract").unwrap();
        fs::write(&native, "canonical review contract").unwrap();
        let paths = Paths::new(Some(root)).unwrap();
        assert_eq!(path(&paths, "change-reviewer").unwrap(), native);
        assert_eq!(
            fs::read_to_string(path(&paths, "change-reviewer").unwrap()).unwrap(),
            "canonical review contract"
        );
        fs::remove_file(native).unwrap();
        assert!(
            path(&paths, "change-reviewer").is_err(),
            "must not fall back to legacy instructions"
        );
    }
}
