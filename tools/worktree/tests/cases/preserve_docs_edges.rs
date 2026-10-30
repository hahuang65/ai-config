use super::preserve_docs::ignored_project;
use std::{
    ffi::CString,
    fs,
    os::unix::{ffi::OsStrExt, fs::symlink},
    process::Command,
};

#[test]
fn ignored_symlinks_outside_docs_do_not_block_copying() {
    let p = ignored_project();
    fs::create_dir_all(p.root.join(".git/info")).unwrap();
    fs::write(p.root.join(".git/info/exclude"), "/docs/\n/cache-link\n").unwrap();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    fs::write(p.task.join("docs/design.md"), "private bytes").unwrap();
    symlink(&p.root, p.task.join("cache-link")).unwrap();
    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(cleaned["removed"], true);
    assert_eq!(
        fs::read_to_string(p.root.join("docs/design.md")).unwrap(),
        "private bytes"
    );
    assert!(p.root.join(".git").exists());
}

#[test]
fn unsupported_private_doc_fifos_are_retained_without_blocking_or_copying() {
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    let path = p.task.join("docs/live-input");
    let name = CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: the fixture path is NUL-terminated and belongs to this disposable repository.
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    let output = p.run(&p.root, &["clean", "feature", "--json"]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("not a regular file"));
    assert!(path.exists());
    assert!(!p.root.join("docs").exists());
    assert!(
        !p.git(&p.root, &["branch", "--list", "tu/feature"])
            .is_empty()
    );
}

#[test]
fn private_docs_with_shared_source_inodes_are_all_preserved_in_one_cleanup() {
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    fs::write(p.task.join("docs/first.md"), "shared bytes").unwrap();
    fs::hard_link(p.task.join("docs/first.md"), p.task.join("docs/second.md")).unwrap();
    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(cleaned["docsPreserved"], 2);
    assert_eq!(
        fs::read(p.root.join("docs/first.md")).unwrap(),
        b"shared bytes"
    );
    assert_eq!(
        fs::read(p.root.join("docs/second.md")).unwrap(),
        b"shared bytes"
    );
    assert!(!p.task.exists());
}

#[test]
fn private_docs_are_copied_and_verified_across_multiple_binary_buffers() {
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    let contents: Vec<_> = (0..200_123).map(|number| (number % 251) as u8).collect();
    fs::write(p.task.join("docs/figure.bin"), &contents).unwrap();
    fs::write(p.task.join("docs/empty.md"), []).unwrap();
    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(cleaned["docsPreserved"], 2);
    assert_eq!(fs::read(p.root.join("docs/figure.bin")).unwrap(), contents);
    assert!(fs::read(p.root.join("docs/empty.md")).unwrap().is_empty());
    assert!(!p.task.exists());
}

#[test]
#[cfg(target_os = "linux")]
fn private_doc_names_round_trip_non_utf8_bytes_on_supporting_filesystems() {
    use std::os::unix::ffi::OsStringExt;
    let p = ignored_project();
    fs::create_dir_all(p.task.join("docs")).unwrap();
    let name = std::ffi::OsString::from_vec(b"private-\xff.md".to_vec());
    fs::write(p.task.join("docs").join(&name), "private bytes").unwrap();
    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(cleaned["docsPreserved"], 1);
    assert_eq!(
        fs::read(p.root.join("docs").join(name)).unwrap(),
        b"private bytes"
    );
    assert!(!p.task.exists());
}

#[test]
fn tracked_cr_names_do_not_hide_distinct_ignored_lf_names() {
    let p = ignored_project();
    let tracked = "docs/design\rnotes.md";
    let private = "docs/design\nnotes.md";
    fs::create_dir_all(p.task.join("docs")).unwrap();
    fs::write(p.task.join(tracked), "tracked bytes").unwrap();
    p.git(&p.task, &["add", "-f", "--", tracked]);
    p.git(&p.task, &["commit", "-m", "tracked CR filename"]);
    p.git(&p.root, &["merge", "--ff-only", "tu/feature"]);
    fs::write(p.task.join(private), "private bytes").unwrap();
    let cleaned = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(cleaned["removed"], true);
    assert_eq!(cleaned["docsPreserved"], 1);
    assert_eq!(
        fs::read_to_string(p.root.join(private)).unwrap(),
        "private bytes"
    );
    assert_eq!(
        fs::read_to_string(p.root.join(tracked)).unwrap(),
        "tracked bytes"
    );
    assert!(!p.task.exists());
}

#[test]
fn help_describes_private_doc_preservation_instead_of_disposing_all_ignored_files() {
    let output = Command::new(env!("CARGO_BIN_EXE_wt"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("preserve private docs"));
    assert!(!help.contains("ignored files are\n                        disposable"));
}
