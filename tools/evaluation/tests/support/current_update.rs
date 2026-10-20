use super::*;
use sha2::{Digest, Sha256};
use std::fs;

#[test]
fn report_storage_uses_one_25_mib_bound_for_json_and_html() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap();
    let directory = root.join("review-large");
    fs::create_dir(&directory).unwrap();
    let store = Store { root };
    let html = "a".repeat(25 * 1024 * 1024);
    let mut report: Report = serde_json::from_value(serde_json::json!({"version":1,
        "scope":{"kind":"local","repository":"fixture","base":"base","head":"head","comparison_base":"base","path_filter":null,"pull_request":null},
        "intent":"Review the fixture","digest":"frozen-source","html_digest":format!("{:x}",Sha256::digest(&html)),
        "summary":"","risk":"low","uncertainties":[],"findings":[],"files_read":[]})).unwrap();
    let overhead = serde_json::to_vec(&report).unwrap().len();
    report.summary = "a".repeat(25 * 1024 * 1024 - overhead);
    assert_eq!(serde_json::to_vec(&report).unwrap().len(), 25 * 1024 * 1024);
    store.save(&directory, &report, &html).unwrap();
    let (_, loaded) = store.load(&directory.join("report.html")).unwrap();
    assert_eq!(loaded.summary, report.summary);
    report.summary.push('a');
    assert!(store.replace_report(&directory, &report, &html).is_err());
    assert!(
        store
            .replace_report(&directory, &loaded, &format!("{html}a"))
            .is_err()
    );
    assert!(store.load(&directory.join("report.html")).is_ok());
}

#[test]
fn a_failed_wording_update_does_not_create_a_recovery_job() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap();
    let directory = root.join("review-current");
    fs::create_dir(&directory).unwrap();
    let store = Store { root };
    let mut report: Report = serde_json::from_value(serde_json::json!({"version":1,
        "scope":{"kind":"local","repository":"fixture","base":"base","head":"head","comparison_base":"base","path_filter":null,"pull_request":null},
        "intent":"Review the fixture","digest":"frozen-source","html_digest":format!("{:x}",Sha256::digest("old")),
        "summary":"Old wording","risk":"low","uncertainties":[],"findings":[],"files_read":[]})).unwrap();
    store.save(&directory, &report, "old").unwrap();
    report.summary = "New wording".into();
    report.html_digest = format!("{:x}", Sha256::digest("new"));
    fs::create_dir(directory.join("response-settings.json")).unwrap();
    let objects = BTreeMap::from([("response-settings.json".into(), serde_json::json!({}))]);
    assert!(replace(&store, &directory, report, "new".into(), objects).is_err());
    assert!(!directory.join("current-update.json").exists());
    let (_, current) = store.load(&directory.join("report.html")).unwrap();
    assert_eq!(current.summary, "New wording");
    assert_eq!(
        fs::read_to_string(directory.join("report.html")).unwrap(),
        "new"
    );
    assert!(!directory.join("current-update.json").exists());
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 4);
}
