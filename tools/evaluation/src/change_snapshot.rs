pub use crate::change_diff::{inline, lines};
use crate::{
    change_args::Target,
    change_diff, change_git as git, change_store,
    change_types::{Exclusions, PullRequest, Scope, Tree},
};
use anyhow::{Context, Result, ensure};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub struct Evidence {
    pub scope: Scope,
    pub before: Tree,
    pub after: Tree,
    pub exclusions: Exclusions,
}
type TargetRevisions = (&'static str, String, String, Option<PullRequest>);

fn revisions(repo: &Path, target: &Target) -> Result<TargetRevisions> {
    Ok(match target {
        Target::Branch(branch) => (
            "branch",
            crate::change_subject::trunk(repo)?,
            git::revision(repo, branch)?,
            None,
        ),
        Target::Current | Target::Working { .. } => {
            crate::change_subject::verify(repo, target)?;
            ensure!(
                git::run(repo, &["ls-files", "--unmerged", "-z"])?.is_empty(),
                "Resolve Git conflicts before reviewing local changes"
            );
            (
                "branch-working",
                crate::change_subject::trunk(repo)?,
                git::revision(repo, "HEAD")?,
                None,
            )
        }
        Target::Local => {
            ensure!(
                git::run(repo, &["ls-files", "--unmerged", "-z"])?.is_empty(),
                "Resolve Git conflicts before reviewing local changes"
            );
            let head = git::revision(repo, "HEAD")?;
            ("local", head.clone(), head, None)
        }
        Target::Expression(expression) => {
            let (base, head) = git::range(repo, expression)?;
            ("range", base, head, None)
        }
        Target::Range(base, head) => (
            "range",
            git::revision(repo, base)?,
            git::revision(repo, head)?,
            None,
        ),
        Target::Pull(url) => {
            let (pr, base, head, _) =
                crate::change_provider::resolve(repo, &crate::change_provider::identity(url)?)?;
            ensure!(
                git::revision(repo, &base)? == base && git::revision(repo, &head)? == head,
                "Fetch the exact reviewed commits into --repo before reviewing"
            );
            ("pull-request", base, head, Some(pr))
        }
        _ => anyhow::bail!("Unsupported review target"),
    })
}

fn scope(repo: &Path, target: &Target, filter: Option<&str>) -> Result<Scope> {
    let (kind, base, head, pull_request) = revisions(repo, target)?;
    let comparison_base = if pull_request.is_some() || matches!(kind, "branch" | "branch-working") {
        crate::change_subject::merge_base(repo, &base, &head)?
    } else {
        base.clone()
    };
    Ok(Scope {
        kind: kind.into(),
        repository: repo
            .to_str()
            .context("Repository path is not UTF-8")?
            .into(),
        base,
        head,
        comparison_base,
        pull_request,
        path_filter: filter.map(str::to_owned),
    })
}

pub fn freeze(repo: &Path, target: &Target, filter: Option<&str>) -> Result<Evidence> {
    let scope = scope(repo, target, filter)?;
    let mut exclusions = Exclusions::new();
    let mut before = git::tree(repo, &scope.comparison_base, &mut exclusions, filter)?;
    let mut after_excluded = Exclusions::new();
    let working = matches!(scope.kind.as_str(), "local" | "branch-working");
    let mut after = if working {
        git::working(repo, &mut after_excluded, filter)?
    } else {
        git::tree(repo, &scope.head, &mut after_excluded, filter)?
    };
    if working {
        crate::change_subject::verify(repo, target)?;
        let mut rechecked = Exclusions::new();
        ensure!(
            git::revision(repo, "HEAD")? == scope.head
                && git::working(repo, &mut rechecked, filter)? == after
                && rechecked == after_excluded,
            "Local source changed while taking the snapshot; retry when edits stop"
        );
    }
    exclusions.extend(after_excluded);
    ensure!(
        filter.is_none() || !before.is_empty() || !after.is_empty() || !exclusions.is_empty(),
        "--path matches no source files"
    );
    let available = |path: &String, _: &mut crate::change_types::Blob| {
        !exclusions
            .keys()
            .any(|excluded| path == excluded || path.starts_with(&format!("{excluded}/")))
    };
    before.retain(available);
    after.retain(available);
    Ok(Evidence {
        scope,
        before,
        after,
        exclusions,
    })
}

fn save_trees(snapshot: &Path, evidence: &Evidence) -> Result<String> {
    let mut hash = Sha256::new();
    for (side, tree) in [("before", &evidence.before), ("after", &evidence.after)] {
        fs::create_dir(snapshot.join(side))?;
        for (path, blob) in tree {
            let target = snapshot.join(side).join(path);
            fs::create_dir_all(target.parent().unwrap())?;
            change_store::write(&target, &blob.bytes)?;
            hash.update([u8::from(blob.executable)]);
            for part in [side.as_bytes(), path.as_bytes(), blob.bytes.as_slice()] {
                hash.update((part.len() as u64).to_be_bytes());
                hash.update(part);
            }
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn save(directory: &Path, evidence: &Evidence) -> Result<(String, String)> {
    let snapshot = directory.join("snapshot");
    fs::create_dir(&snapshot)?;
    let digest = save_trees(&snapshot, evidence)?;
    let patch = change_diff::capture(&snapshot, evidence)?;
    change_store::write(&snapshot.join("patch.diff"), patch.as_bytes())?;
    let manifest = json!({"scope":evidence.scope,"before":evidence.before.keys().collect::<Vec<_>>(),"after":evidence.after.keys().collect::<Vec<_>>(),"excluded":evidence.exclusions,
        "modes":{"before":change_diff::modes(&evidence.before),"after":change_diff::modes(&evidence.after)},
        "limits":"Excluded paths are removed from both endpoints. Snapshot files are non-executable; original modes are recorded here and as separate diff entries. This is review evidence, not an apply-ready patch."});
    change_store::write(
        &snapshot.join("scope.json"),
        &serde_json::to_vec_pretty(&manifest)?,
    )?;
    Ok((digest, patch))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::change_types::{Blob, Scope};

    #[test]
    fn large_scope_manifest_has_short_lines_for_bounded_snapshot_reads() {
        let directory = tempfile::tempdir().unwrap();
        let repo = directory.path().join("repo");
        fs::create_dir(&repo).unwrap();
        let review = directory.path().join("review");
        fs::create_dir(&review).unwrap();
        let mut after = Tree::new();
        for index in 0..400 {
            after.insert(
                format!("fixtures/long-scope-entry-{index:04}-source.txt"),
                Blob {
                    bytes: b"safe fixture\n".to_vec(),
                    executable: false,
                },
            );
        }
        let evidence = Evidence {
            scope: Scope {
                kind: "local".into(),
                repository: repo.to_string_lossy().into_owned(),
                base: "a".repeat(40),
                head: "a".repeat(40),
                comparison_base: "a".repeat(40),
                path_filter: None,
                pull_request: None,
            },
            before: Tree::new(),
            after,
            exclusions: Exclusions::new(),
        };
        save(&review, &evidence).unwrap();
        let text = fs::read_to_string(review.join("snapshot/scope.json")).unwrap();
        assert!(
            text.len() > 32 * 1024,
            "fixture must exceed a single read response"
        );
        assert!(
            text.lines().all(|line| line.len() < 8192),
            "each line must be readable by the restricted reviewer"
        );
        let manifest: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(manifest["after"].as_array().unwrap().len(), 400);
    }
}
