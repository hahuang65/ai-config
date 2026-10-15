use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

enum Entry {
    Directory(PathBuf),
    File(PathBuf, Vec<u8>),
}

// Cache only immutable empty-repository bytes, for this test process's lifetime.
// Each fixture gets new files; no shared writable repository or persistent cache.
pub fn initialize(path: &Path) {
    static TEMPLATE: OnceLock<Vec<Entry>> = OnceLock::new();
    for entry in TEMPLATE.get_or_init(template) {
        match entry {
            Entry::Directory(relative) => fs::create_dir(path.join(relative)).unwrap(),
            Entry::File(relative, bytes) => fs::write(path.join(relative), bytes).unwrap(),
        }
    }
}

fn template() -> Vec<Entry> {
    let seed = tempfile::tempdir().unwrap();
    super::git(seed.path(), &["init", "-q", "--template="]);
    let mut entries = Vec::new();
    capture(seed.path(), Path::new(""), &mut entries);
    entries
}

fn capture(root: &Path, relative: &Path, entries: &mut Vec<Entry>) {
    for item in fs::read_dir(root.join(relative)).unwrap() {
        let item = item.unwrap();
        let child = relative.join(item.file_name());
        let kind = item.file_type().unwrap();
        if kind.is_dir() {
            entries.push(Entry::Directory(child.clone()));
            capture(root, &child, entries);
        } else {
            assert!(
                kind.is_file(),
                "repository seed must contain only regular files"
            );
            entries.push(Entry::File(child, fs::read(item.path()).unwrap()));
        }
    }
}
