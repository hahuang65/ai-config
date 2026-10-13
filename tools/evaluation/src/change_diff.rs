use crate::{
    change_git as git,
    change_snapshot::Evidence,
    change_types::{Side, Tree},
    reviewer_process,
};
use anyhow::{Context, Result, ensure};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

fn mode(executable: bool) -> &'static str {
    if executable { "100755" } else { "100644" }
}

pub fn modes(tree: &Tree) -> BTreeMap<&str, &str> {
    tree.iter()
        .map(|(path, blob)| (path.as_str(), mode(blob.executable)))
        .collect()
}

pub fn capture(snapshot: &Path, evidence: &Evidence) -> Result<String> {
    let mut command = git::command_excluding(snapshot, Path::new(&evidence.scope.repository))?;
    command.args([
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--text",
        "--unified=3",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--",
        "before",
        "after",
    ]);
    let raw = String::from_utf8(reviewer_process::run_accepted(command, 30, &[0, 1])?)?;
    let mut patch = String::new();
    for line in raw.lines() {
        if ["index ", "new file mode ", "deleted file mode "]
            .iter()
            .any(|prefix| line.starts_with(prefix))
        {
            continue;
        }
        patch.push_str(line);
        patch.push('\n');
    }
    patch.push_str(&mode_changes(evidence)?);
    Ok(patch)
}

fn mode_changes(evidence: &Evidence) -> Result<String> {
    let paths: BTreeSet<_> = evidence
        .before
        .keys()
        .chain(evidence.after.keys())
        .collect();
    let mut patch = String::new();
    for path in paths {
        let before = evidence.before.get(path).map(|blob| mode(blob.executable));
        let after = evidence.after.get(path).map(|blob| mode(blob.executable));
        if before == after {
            continue;
        }
        let old_path = serde_json::to_string(&format!("a/before/{path}"))?;
        let new_path = serde_json::to_string(&format!("b/after/{path}"))?;
        patch.push_str(&format!("diff --git {old_path} {new_path}\n"));
        match (before, after) {
            (Some(old), Some(new)) => patch.push_str(&format!("old mode {old}\nnew mode {new}\n")),
            (None, Some(new)) => patch.push_str(&format!("new file mode {new}\n")),
            (Some(old), None) => patch.push_str(&format!("deleted file mode {old}\n")),
            _ => unreachable!(),
        }
    }
    Ok(patch)
}

fn header(line: &str) -> Option<String> {
    let name = line.get(4..)?.trim_end_matches('\t');
    let name = if name.starts_with('"') {
        serde_json::from_str::<String>(name).ok()?
    } else {
        name.to_owned()
    };
    name.strip_prefix("a/before/")
        .or_else(|| name.strip_prefix("b/after/"))
        .map(str::to_owned)
}

fn coordinate(field: &str) -> Result<(u64, u64)> {
    let (start, count) = field
        .get(1..)
        .context("Invalid hunk coordinate")?
        .split_once(',')
        .unwrap_or((&field[1..], "1"));
    Ok((start.parse()?, count.parse()?))
}

pub fn lines(patch: &str) -> Result<BTreeSet<(String, String, u64)>> {
    let mut proven = BTreeSet::new();
    let (mut path, mut left, mut right, mut old, mut new) = (String::new(), 0, 0, 0, 0);
    for line in patch.lines() {
        if old > 0 || new > 0 {
            match line.as_bytes().first() {
                Some(b'-') if old > 0 => {
                    proven.insert((path.clone(), "LEFT".into(), left));
                    left += 1;
                    old -= 1;
                }
                Some(b'+') if new > 0 => {
                    proven.insert((path.clone(), "RIGHT".into(), right));
                    right += 1;
                    new -= 1;
                }
                Some(b' ') if old > 0 && new > 0 => {
                    left += 1;
                    right += 1;
                    old -= 1;
                    new -= 1;
                }
                Some(b'\\') => {}
                _ => anyhow::bail!("Invalid diff hunk"),
            }
        } else if line.starts_with("--- ") || line.starts_with("+++ ") {
            if let Some(name) = header(line) {
                path = name;
            }
        } else if line.starts_with("@@ ") {
            let fields: Vec<_> = line.split_whitespace().collect();
            ensure!(
                fields.len() >= 4 && fields[3] == "@@",
                "Invalid diff header"
            );
            (left, old) = coordinate(fields[1])?;
            (right, new) = coordinate(fields[2])?;
        }
    }
    ensure!(old == 0 && new == 0, "Incomplete diff");
    Ok(proven)
}

pub fn inline(
    proven: &BTreeSet<(String, String, u64)>,
    path: &str,
    side: &Side,
    line: Option<u64>,
) -> bool {
    line.is_some_and(|line| proven.contains(&(path.into(), side.as_str().into(), line)))
}
