use super::Project;
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt, symlink},
};

pub(super) fn ignored_project() -> Project {
    let p = Project::new();
    fs::create_dir_all(p.root.join(".git/info")).unwrap();
    fs::write(p.root.join(".git/info/exclude"), "/docs/\n").unwrap();
    p
}

#[test]
fn private_docs_never_follow_source_or_destination_symlinks() {
    for kind in ["source", "destination", "destination parent"] {
        let p = ignored_project();
        let outside = p.root.parent().unwrap().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("design.md"), "outside bytes").unwrap();
        fs::create_dir_all(p.task.join("docs/private")).unwrap();
        fs::write(p.task.join("docs/private/design.md"), "task bytes").unwrap();
        match kind {
            "source" => {
                fs::remove_file(p.task.join("docs/private/design.md")).unwrap();
                symlink(
                    outside.join("design.md"),
                    p.task.join("docs/private/design.md"),
                )
                .unwrap();
            }
            "destination" => {
                fs::create_dir_all(p.root.join("docs/private")).unwrap();
                symlink(
                    outside.join("design.md"),
                    p.root.join("docs/private/design.md"),
                )
                .unwrap();
            }
            _ => {
                fs::create_dir(p.root.join("docs")).unwrap();
                symlink(&outside, p.root.join("docs/private")).unwrap();
            }
        }
        let output = p.run(&p.root, &["clean", "feature", "--json"]);
        assert!(!output.status.success(), "{kind}");
        assert!(p.task.join("docs/private/design.md").exists(), "{kind}");
        assert_eq!(
            fs::read_to_string(outside.join("design.md")).unwrap(),
            "outside bytes"
        );
        assert!(
            !p.git(&p.root, &["branch", "--list", "tu/feature"])
                .is_empty()
        );
    }
}

#[test]
fn a_different_primary_document_stops_cleanup_without_overwriting_or_copying() {
    let p = ignored_project();
    for root in [&p.root, &p.task] {
        fs::create_dir_all(root.join("docs/private")).unwrap();
    }
    fs::write(p.root.join("docs/private/design.md"), "primary version").unwrap();
    fs::write(p.task.join("docs/private/design.md"), "task version").unwrap();
    fs::write(p.task.join("docs/private/another.md"), "must not copy yet").unwrap();
    let before = fs::metadata(p.root.join("docs/private/design.md")).unwrap();
    for options in [
        vec!["clean", "feature", "--check", "--json"],
        vec!["clean", "feature", "--json"],
    ] {
        let output = p.run(&p.root, &options);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("Resolve the conflict"));
        assert!(output.stdout.is_empty());
        assert!(p.task.join("docs/private/design.md").exists());
        assert!(!p.root.join("docs/private/another.md").exists());
        assert_eq!(
            fs::read_to_string(p.root.join("docs/private/design.md")).unwrap(),
            "primary version"
        );
        assert_eq!(
            fs::metadata(p.root.join("docs/private/design.md"))
                .unwrap()
                .ino(),
            before.ino()
        );
    }
    assert!(
        !p.git(&p.root, &["branch", "--list", "tu/feature"])
            .is_empty()
    );
}

#[test]
fn an_identical_primary_document_is_verified_without_replacing_it() {
    let p = ignored_project();
    for root in [&p.root, &p.task] {
        fs::create_dir_all(root.join("docs")).unwrap();
    }
    for root in [&p.root, &p.task] {
        fs::write(root.join("docs/design.md"), "same bytes").unwrap();
    }
    let before = fs::metadata(p.root.join("docs/design.md")).unwrap();
    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(cleaned["docsPreserved"], 1);
    assert_eq!(cleaned["removed"], true);
    let after = fs::metadata(p.root.join("docs/design.md")).unwrap();
    assert_eq!(
        (after.ino(), after.mtime(), after.ctime()),
        (before.ino(), before.mtime(), before.ctime())
    );
    assert_eq!(
        fs::read_to_string(p.root.join("docs/design.md")).unwrap(),
        "same bytes"
    );
}

#[test]
fn nonignored_untracked_docs_still_block_cleanup_without_copying() {
    let p = Project::new();
    fs::create_dir_all(p.task.join("docs/private")).unwrap();
    fs::write(p.task.join("docs/private/design.md"), "keep this design\n").unwrap();
    for options in [
        vec!["clean", "feature", "--check", "--json"],
        vec!["clean", "feature", "--json"],
    ] {
        let output = p.run(&p.root, &options);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("Save them before cleanup"));
        assert!(!p.root.join("docs").exists());
        assert!(p.task.join("docs/private/design.md").exists());
    }
    assert!(
        !p.git(&p.root, &["branch", "--list", "tu/feature"])
            .is_empty()
    );
}

#[test]
fn changed_sources_or_corrupted_copies_stop_cleanup_without_unlinking_docs() {
    for changed in ["source", "copy", "inventory"] {
        let p = ignored_project();
        fs::create_dir_all(p.task.join("docs")).unwrap();
        fs::write(p.task.join("docs/design.md"), "original bytes").unwrap();
        let base = p.root.parent().unwrap();
        fs::write(base.join("change-kind"), changed).unwrap();
        fs::create_dir(base.join("bin")).unwrap();
        let script = base.join("bin/git");
        fs::write(
            &script,
            r#"#!/bin/sh
if [ "$1" = --no-pager ]; then shift; fi
base="$(dirname "$0")/.."
if [ "$1" = ls-files ] && [ -f "$base/project/docs/design.md" ] && [ ! -e "$base/mutated" ]; then
  touch "$base/mutated"
  case "$(/bin/cat "$base/change-kind")" in
    source) printf changed > "$base/trees/project/feature/docs/design.md" ;;
    copy) printf corrupted > "$base/project/docs/design.md" ;;
    inventory) printf new > "$base/trees/project/feature/docs/new.md" ;;
  esac
fi
exec /usr/bin/git "$@"
"#,
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let output = p.run(&p.root, &["clean", "feature", "--json"]);
        assert!(!output.status.success(), "{changed}");
        assert!(
            base.join("mutated").exists(),
            "exercise the post-copy verification"
        );
        assert!(p.task.join("docs/design.md").exists(), "{changed}");
        assert!(
            !p.git(&p.root, &["branch", "--list", "tu/feature"])
                .is_empty()
        );
    }
}

#[test]
fn a_new_task_commit_during_doc_copy_retains_the_worktree_and_both_doc_copies() {
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    fs::write(p.task.join("docs/design.md"), "private notes").unwrap();
    let base = p.root.parent().unwrap();
    fs::create_dir(base.join("bin")).unwrap();
    let script = base.join("bin/git");
    fs::write(&script, r#"#!/bin/sh
if [ "$1" = --no-pager ]; then shift; fi
base="$(dirname "$0")/.."
if [ "$1" = ls-files ] && [ -f "$base/project/docs/design.md" ] && [ ! -e "$base/committed" ]; then
  touch "$base/committed"
  /usr/bin/git -C "$base/trees/project/feature" -c commit.gpgsign=false commit --allow-empty -m concurrent >&2 || exit
fi
exec /usr/bin/git "$@"
"#).unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    let output = p.run(&p.root, &["clean", "feature", "--json"]);
    assert!(!output.status.success());
    assert!(base.join("committed").exists());
    assert!(p.task.join("docs/design.md").exists());
    assert_eq!(
        fs::read_to_string(p.root.join("docs/design.md")).unwrap(),
        "private notes"
    );
    assert!(
        !p.git(&p.root, &["branch", "--list", "tu/feature"])
            .is_empty()
    );
}

#[test]
fn unrelated_dirty_work_and_missing_integration_still_prevent_doc_copy_and_cleanup() {
    for kind in [
        "outside untracked",
        "tracked doc edit",
        "unintegrated",
        "locked",
    ] {
        let p = ignored_project();
        fs::create_dir_all(p.task.join("docs")).unwrap();
        fs::write(p.task.join("docs/private.md"), "private notes").unwrap();
        match kind {
            "outside untracked" => {
                fs::write(p.task.join("docs-other.txt"), "keep").unwrap();
            }
            "tracked doc edit" => {
                fs::write(p.task.join("docs/tracked.md"), "tracked").unwrap();
                p.git(&p.task, &["add", "-f", "docs/tracked.md"]);
                p.git(&p.task, &["commit", "-m", "tracked docs"]);
                p.git(&p.root, &["merge", "--ff-only", "tu/feature"]);
                fs::write(p.task.join("docs/tracked.md"), "edited").unwrap();
            }
            "unintegrated" => {
                p.git(
                    &p.task,
                    &["commit", "--allow-empty", "-m", "not integrated"],
                );
            }
            _ => {
                p.git(&p.root, &["worktree", "lock", p.task.to_str().unwrap()]);
            }
        }
        let output = p.run(&p.root, &["clean", "feature", "--json"]);
        assert!(!output.status.success(), "{kind}");
        assert!(p.task.join("docs/private.md").exists(), "{kind}");
        assert!(!p.root.join("docs/private.md").exists(), "{kind}");
        assert!(
            !p.git(&p.root, &["branch", "--list", "tu/feature"])
                .is_empty()
        );
    }
}

#[test]
fn private_document_names_preserve_spaces_unicode_and_control_bytes() {
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    let names = [
        "design π ' notes.md",
        "line\r\nname.md",
        "tabs\tand space.md",
    ];
    for name in names {
        fs::write(p.task.join("docs").join(name), name.as_bytes()).unwrap();
    }
    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(cleaned["docsPreserved"], names.len());
    for name in names {
        assert_eq!(
            fs::read(p.root.join("docs").join(name)).unwrap(),
            name.as_bytes()
        );
    }
    assert!(!p.task.exists());
}

#[test]
fn a_git_removal_failure_keeps_verified_primary_docs_and_reports_their_location() {
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    fs::write(p.task.join("docs/design.md"), "private notes").unwrap();
    let base = p.root.parent().unwrap();
    fs::create_dir(base.join("bin")).unwrap();
    let script = base.join("bin/git");
    fs::write(
        &script,
        r#"#!/bin/sh
if [ "$1" = --no-pager ]; then shift; fi
if [ "$1" = worktree ] && [ "$2" = remove ]; then exit 1; fi
exec /usr/bin/git "$@"
"#,
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
    let output = p.run(&p.root, &["clean", "feature", "--json"]);
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("Verified private docs remain in the primary checkout")
    );
    assert!(p.task.exists());
    assert_eq!(
        fs::read_to_string(p.root.join("docs/design.md")).unwrap(),
        "private notes"
    );
    assert!(
        !p.git(&p.root, &["branch", "--list", "tu/feature"])
            .is_empty()
    );
}

#[test]
fn private_doc_ignore_files_are_copied_without_unlinking_source_files() {
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs/private")).unwrap();
    fs::write(p.task.join("docs/.gitignore"), "private/\n").unwrap();
    fs::write(p.task.join("docs/private/design.md"), "ignored design").unwrap();
    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(cleaned["removed"], true);
    assert_eq!(cleaned["docsPreserved"], 2);
    assert_eq!(
        fs::read_to_string(p.root.join("docs/.gitignore")).unwrap(),
        "private/\n"
    );
    assert_eq!(
        fs::read_to_string(p.root.join("docs/private/design.md")).unwrap(),
        "ignored design"
    );
    assert!(!p.task.exists());
}

#[test]
fn human_cleanup_output_distinguishes_planned_and_completed_doc_preservation() {
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    fs::write(p.task.join("docs/design.md"), "private notes").unwrap();
    let check = p.run(&p.root, &["clean", "feature", "--check"]);
    assert!(check.status.success());
    assert!(String::from_utf8_lossy(&check.stdout).contains("Private docs to preserve: 1."));
    assert!(!p.root.join("docs/design.md").exists());
    let clean = p.run(&p.root, &["clean", "feature"]);
    assert!(clean.status.success());
    assert!(
        String::from_utf8_lossy(&clean.stdout).contains("Private docs preserved in primary: 1.")
    );
    assert_eq!(
        fs::read_to_string(p.root.join("docs/design.md")).unwrap(),
        "private notes"
    );
}

#[test]
fn cleanup_preserves_ignored_docs_at_the_same_primary_paths_before_removal() {
    let p = Project::new();
    fs::create_dir_all(p.root.join(".git/info")).unwrap();
    fs::write(p.root.join(".git/info/exclude"), "/docs/\n").unwrap();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    fs::write(p.task.join("docs/tracked.md"), "tracked bytes").unwrap();
    p.git(&p.task, &["add", "-f", "docs/tracked.md"]);
    p.git(&p.task, &["commit", "-m", "tracked docs"]);
    p.git(&p.root, &["merge", "--ff-only", "tu/feature"]);
    fs::write(p.root.join("docs/tracked.md"), "unrelated primary edit").unwrap();
    let index = fs::read(p.root.join(".git/index")).unwrap();
    fs::create_dir_all(p.task.join("docs/private/nested")).unwrap();
    let contents = b"private design\n\0binary-safe\n";
    fs::write(p.task.join("docs/private/nested/design.md"), contents).unwrap();

    let check = p.ok(&p.root, &["clean", "feature", "--check", "--json"]);
    assert_eq!(check["removed"], false);
    assert!(!p.root.join("docs/private").exists());
    assert!(p.task.join("docs/private/nested/design.md").exists());

    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(
        fs::read(p.root.join("docs/private/nested/design.md")).unwrap(),
        contents
    );
    assert_eq!(cleaned["removed"], true);
    assert_eq!(cleaned["branchRemoved"], true);
    assert_eq!(cleaned["docsPreserved"], 1);
    assert_eq!(
        fs::read_to_string(p.root.join("docs/tracked.md")).unwrap(),
        "unrelated primary edit"
    );
    assert_eq!(fs::read(p.root.join(".git/index")).unwrap(), index);
    assert!(!p.task.exists());
}
