use super::scan_resource_tree;
use std::fs;

#[test]
fn bounds_directory_entries_before_adding_them_to_the_queue() {
    let root = tempfile::tempdir().unwrap();
    for name in ["first", "second", "third"] {
        fs::write(root.path().join(name), "fixture").unwrap();
    }
    assert!(scan_resource_tree(root.path(), 2).is_err());
}
