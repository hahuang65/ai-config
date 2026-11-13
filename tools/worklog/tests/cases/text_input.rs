use crate::{rows, support::World};
use std::fs;

#[test]
fn note_reads_literal_utf8_text_from_a_file_with_one_terminal_newline() {
    let world = World::new();
    let path = world.home.path().join("note.txt");
    let text = "Worktree `complete` and git: \"quoted\", apostrophe's, — literal $(false)";
    fs::write(&path, format!("{text}\n")).unwrap();
    let result = world.ok(&["note", "--text-file", path.to_str().unwrap()]);
    assert_eq!(result["entry"]["kind"], "note");
    assert_eq!(result["entry"]["text"], text);
    assert_eq!(rows(&world.ok(&["list"]))[0]["title"], text);
}

#[test]
fn progress_file_keeps_the_task_active_and_accepts_a_terminal_crlf() {
    let world = World::new();
    world.ok(&["start", "Task"]);
    let path = world.home.path().join("progress.txt");
    let text = "Verified git and `worklog complete`, with apostrophe's — no execution";
    fs::write(&path, format!("{text}\r\n")).unwrap();
    let result = world.ok(&[
        "progress",
        "--task",
        "1",
        "--text-file",
        path.to_str().unwrap(),
    ]);
    assert_eq!(result["entry"]["kind"], "progress");
    assert_eq!(result["entry"]["task"], 1);
    assert_eq!(result["entry"]["text"], text);
    assert_eq!(rows(&world.ok(&["list"]))[0]["state"], "active");
}

#[test]
fn file_text_rejects_invalid_contents_without_creating_storage_or_echoing_text() {
    let world = World::new();
    let path = world.home.path().join("invalid.txt");
    let inputs = [
        Vec::new(),
        b"   \n".to_vec(),
        b"private\nsecond line\n".to_vec(),
        b"private\0data".to_vec(),
        b"private\tdata".to_vec(),
        vec![0xff],
        vec![b'x'; 2049],
        vec![b'x'; 100_000],
    ];
    for bytes in inputs {
        fs::write(&path, bytes).unwrap();
        for command in ["note", "progress"] {
            let output = world.fail(&[command, "--text-file", path.to_str().unwrap()]);
            assert_eq!(output.status.code(), Some(2));
            assert!(!String::from_utf8_lossy(&output.stderr).contains("private"));
            assert!(!world.root.exists());
        }
    }
}

#[test]
fn file_input_accepts_the_utf8_byte_limit_and_rejects_ambiguous_sources() {
    let world = World::new();
    let path = world.home.path().join("limit.txt");
    let text = "é".repeat(1024);
    fs::write(&path, format!("{text}\r\n")).unwrap();
    for command in ["note", "progress"] {
        world.fail(&[command]);
        world.fail(&[
            command,
            "inline text",
            "--text-file",
            path.to_str().unwrap(),
        ]);
        assert!(!world.root.exists());
    }
    assert_eq!(
        world.ok(&["note", "--text-file", path.to_str().unwrap()])["entry"]["text"],
        text
    );
    assert_eq!(world.ok(&["history"])["total"], 1);
}

#[test]
fn unreadable_or_nonregular_inputs_leave_existing_history_unchanged() {
    let world = World::new();
    world.ok(&["start", "Task"]);
    let missing = world.home.path().join("missing.txt");
    let output = world.fail(&[
        "progress",
        "--task",
        "1",
        "--text-file",
        missing.to_str().unwrap(),
    ]);
    assert_eq!(output.status.code(), Some(1));
    let output = world.fail(&["note", "--text-file", world.home.path().to_str().unwrap()]);
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(world.ok(&["history"])["total"], 1);
    assert_eq!(rows(&world.ok(&["list"]))[0]["state"], "active");
}
