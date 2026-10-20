mod support;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use support::{Trial, change, executable, success};

#[test]
fn review_wording_updates_the_current_report_without_changing_source_or_creating_copies() {
    let trial = change::fixture();
    let generated = change::review(&trial, &["range", "HEAD~1..HEAD"]);
    success(generated.clone());
    let receipt: Value = serde_json::from_slice(&generated.stdout).unwrap();
    let html = receipt["report"].as_str().unwrap();
    let record = Path::new(html).with_extension("json");
    let before = fs::read(&record).unwrap();
    let original: Value = serde_json::from_slice(&before).unwrap();
    let entries = fs::read_dir(Path::new(html).parent().unwrap().parent().unwrap())
        .unwrap()
        .count();
    executable(trial.fake_bin.join("pi"), MODEL);
    let output = respond(
        &trial,
        html,
        &before,
        original["html_digest"].as_str().unwrap(),
    );
    success(output.clone());
    let updated: Value = serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
    assert_eq!(updated["summary"], "Clarified review summary.");
    assert_eq!(updated["findings"][0]["title"], "Clarified finding title");
    assert_eq!(updated["scope"], original["scope"]);
    assert_eq!(updated["digest"], original["digest"]);
    assert_eq!(
        updated["findings"][0]["path"],
        original["findings"][0]["path"]
    );
    assert!(
        fs::read_to_string(html)
            .unwrap()
            .contains("Clarified finding title")
    );
    assert_eq!(
        fs::read(trial.temporary.path().join("repo/source.txt")).unwrap(),
        b"after\n"
    );
    assert_eq!(
        fs::read_dir(Path::new(html).parent().unwrap().parent().unwrap())
            .unwrap()
            .count(),
        entries
    );
    let again = respond(
        &trial,
        html,
        &fs::read(&record).unwrap(),
        updated["html_digest"].as_str().unwrap(),
    );
    success(again);
}

fn respond(trial: &Trial, html: &str, bytes: &[u8], revision: &str) -> std::process::Output {
    trial
        .command()
        .arg("feedback")
        .arg(html)
        .arg(format!("{:x}", Sha256::digest(bytes)))
        .arg(revision)
        .arg(json!({"action":"feedback","message":"Clarify the review wording"}).to_string())
        .output()
        .unwrap()
}

const MODEL: &str = r#"#!/usr/bin/env python3
import os,json
root=os.environ['PI_REVIEW_ROOT']
print(json.dumps({'type':'entry_appended','entry':{'customType':'review-scope-ready','data':{'root':root,'tools':['read']}}}))
for name in ['scope.json','patch.diff','review.json','feedback.json']:
 print(json.dumps({'type':'tool_execution_start','toolCallId':name,'toolName':'read','args':{'path':name}}))
 print(json.dumps({'type':'tool_execution_end','toolCallId':name,'toolName':'read','isError':False}))
answer={'reply':'Clarified the review wording.','revision':{'summary':'Clarified review summary.','findings':[{'id':'F1','title':'Clarified finding title'}]}}
print(json.dumps({'type':'message_end','message':{'role':'assistant','stopReason':'stop','content':[{'type':'text','text':json.dumps(answer)}]}}))
print(json.dumps({'type':'agent_settled'}))
"#;
