use crate::support::{change::*, *};
use std::{
    io::{BufRead, BufReader},
    process::Stdio,
    sync::mpsc,
    thread,
    time::Duration,
};

#[test]
fn json_mode_stays_silent_and_preserves_its_single_receipt() {
    let trial = fixture();
    let output = command(&trial)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    assert!(output.stderr.is_empty());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(receipt["protocolVersion"], 1);
    assert_eq!(receipt["findingCount"], 1);
    assert_eq!(
        output.stdout.iter().filter(|byte| **byte == b'\n').count(),
        1
    );
}

#[test]
fn progress_never_echoes_failed_reads_model_text_or_provider_diagnostics() {
    let trial = fixture();
    let model = MODEL.replace("print(json.dumps({'type':'message_end'", r#"import sys
print('PRIVATE_PROVIDER_DIAGNOSTIC', file=sys.stderr)
print(json.dumps({'type':'message_update','message':{'role':'assistant','content':[{'type':'thinking','thinking':'PRIVATE_REASONING'}]}}))
print(json.dumps({'type':'tool_execution_start','toolCallId':'failed','toolName':'read','args':{'path':'PRIVATE_FAILED_PATH'}}))
print(json.dumps({'type':'tool_execution_end','toolCallId':'failed','toolName':'read','isError':True}))
print(json.dumps({'type':'message_end'"#);
    executable(trial.fake_bin.join("pi"), &model);
    let output = command(&trial)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--no-browser")
        .output()
        .unwrap();
    success(output.clone());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(!stderr.contains("PRIVATE_"));
    assert_eq!(
        stderr
            .lines()
            .filter(|line| line.contains("] READ  "))
            .count(),
        2
    );
    assert!(
        !String::from_utf8(output.stdout)
            .unwrap()
            .contains("PRIVATE_")
    );
}

#[test]
fn verbose_activity_is_bounded_and_points_to_the_complete_retained_read_list() {
    let trial = fixture();
    for index in 0..55 {
        put(
            trial
                .temporary
                .path()
                .join(format!("repo/proof-{index}.txt")),
            "evidence\n",
        );
    }
    git(&trial, &["add", "."]);
    git(&trial, &["commit", "-m", "evidence files"]);
    let model = MODEL.replace("print(json.dumps({'type':'message_end'", r#"for index in range(55):
    path='after/proof-'+str(index)+'.txt'
    print(json.dumps({'type':'tool_execution_start','toolCallId':path,'toolName':'read','args':{'path':path}}))
    print(json.dumps({'type':'tool_execution_end','toolCallId':path,'toolName':'read','isError':False}))
print(json.dumps({'type':'message_end'"#);
    executable(trial.fake_bin.join("pi"), &model);
    let output = command(&trial)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--no-browser")
        .output()
        .unwrap();
    success(output.clone());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert_eq!(
        stderr
            .lines()
            .filter(|line| line.contains("] READ  "))
            .count(),
        50
    );
    assert!(stderr.contains("Further file names omitted; the full read list is in report.json"));
    let stdout = String::from_utf8(output.stdout).unwrap();
    let path = stdout
        .lines()
        .next()
        .unwrap()
        .strip_prefix("1 findings. HTML report: ")
        .unwrap();
    let record = read_json(std::path::Path::new(path).with_file_name("report.json"));
    assert_eq!(record["files_read"].as_array().unwrap().len(), 57);
}

#[test]
fn invalid_findings_show_validation_progress_but_never_claim_a_saved_report() {
    let trial = fixture();
    let output = command(&trial)
        .env("CHANGE_TEST_MODE", "malformed")
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--no-browser")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("] START Validating findings"));
    assert!(stderr.contains("] FAIL  Validating findings (elapsed "));
    assert!(!stderr.contains("7/7 stages processed"));
    assert!(!stderr.contains("Saving report"));
    assert!(stderr.contains("Reviewer did not return the required finding schema"));
}

#[test]
fn human_cli_reports_review_stages_without_mixing_them_into_the_result() {
    let trial = fixture();
    let output = command(&trial)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--no-browser")
        .output()
        .unwrap();
    success(output.clone());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        !stderr.contains('\u{1b}'),
        "Redirected logs must not contain terminal controls"
    );
    let log = messages(&stderr);
    let names = [
        "Resolving review target",
        "Freezing source evidence",
        "Running restricted reviewer",
        "Validating findings",
        "Saving report",
    ];
    let starts: Vec<_> = log
        .iter()
        .filter_map(|line| line.strip_prefix("START "))
        .collect();
    assert_eq!(starts, names);
    for name in names {
        let start = log
            .iter()
            .position(|line| *line == format!("START {name}"))
            .unwrap();
        let end = log
            .iter()
            .position(|line| line.starts_with(&format!("DONE  {name} (elapsed ")))
            .unwrap();
        assert!(start < end);
        let elapsed = log[end]
            .split("(elapsed ")
            .nth(1)
            .unwrap()
            .strip_suffix("s)")
            .unwrap();
        assert!(elapsed.parse::<f64>().unwrap() >= 0.0);
    }
    assert!(
        log.iter()
            .any(|line| line.starts_with("SKIP  Checking pull-request locations and revisions"))
    );
    assert!(
        log.iter()
            .any(|line| line.starts_with("SKIP  Opening report in browser"))
    );
    assert!(
        log.iter()
            .any(|line| line.starts_with("TOTAL 7/7 stages processed; total elapsed "))
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.starts_with("1 findings. HTML report:"));
    assert!(stdout.contains("No comments were posted."));
    assert!(!stdout.contains("Resolving review target"));
}

fn messages(log: &str) -> Vec<&str> {
    log.lines()
        .filter_map(|line| {
            let (time, message) = line.strip_prefix('[')?.split_once("] ")?;
            assert_eq!(time.len(), 8);
            assert_eq!(time.as_bytes()[2], b':');
            assert_eq!(time.as_bytes()[5], b':');
            assert!(time.chars().all(|c| c.is_ascii_digit() || c == ':'));
            Some(message)
        })
        .collect()
}

fn slow_pi(trial: &Trial) {
    let model = MODEL.replace(
        "print(json.dumps({'type':'message_end'",
        r#"import sys,time
sys.stdout.flush()
deadline=time.monotonic()+20
while not os.path.exists(os.environ['PROGRESS_RELEASE']) and time.monotonic()<deadline:
    time.sleep(0.02)
print(json.dumps({'type':'message_end'"#,
    );
    executable(trial.fake_bin.join("pi"), &model);
}

fn live_run(trial: &Trial, engine: &str, expected: &str) -> Vec<String> {
    let release = trial.temporary.path().join("release-reviewer");
    let mut child = command(trial)
        .env("PROGRESS_RELEASE", &release)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--no-browser")
        .args(["--engine", engine])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stderr = child.stderr.take().unwrap();
    let (send, receive) = mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if send.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    let mut observed = Vec::new();
    let live = loop {
        match receive.recv_timeout(Duration::from_secs(10)) {
            Ok(line) => {
                let message = line
                    .split_once("] ")
                    .map(|(_, message)| message)
                    .unwrap_or(&line)
                    .to_owned();
                let read = message.starts_with(expected);
                observed.push(message);
                if read {
                    break child.try_wait().unwrap().is_none();
                }
            }
            Err(_) => break false,
        }
    };
    put(&release, "continue");
    let output = child.wait_with_output().unwrap();
    reader.join().unwrap();
    success(output);
    assert!(
        live,
        "Evidence activity was not visible while the reviewer ran: {observed:?}"
    );
    observed
}

#[test]
fn human_cli_reports_confirmed_evidence_reads_before_the_reviewer_finishes() {
    let trial = fixture();
    slow_pi(&trial);
    let observed = live_run(
        &trial,
        "pi",
        "READ  patch.diff (2 evidence files inspected)",
    );
    assert!(
        observed
            .iter()
            .any(|line| line == "READ  scope.json (1 evidence file inspected)")
    );
}

#[test]
fn claude_cli_reports_its_own_verified_reads_before_completion() {
    let trial = fixture();
    let setup = MODEL
        .split_once("print(json.dumps({'type':'entry_appended'")
        .unwrap()
        .0
        .replace("root = os.environ['PI_REVIEW_ROOT']", "root = os.getcwd()");
    executable(trial.fake_bin.join("claude"), &format!("{setup}{CLAUDE}"));
    let observed = live_run(
        &trial,
        "claude",
        "READ  patch.diff (2 evidence files inspected)",
    );
    assert!(
        observed
            .iter()
            .any(|line| line == "READ  scope.json (1 evidence file inspected)")
    );
}

const CLAUDE: &str = r#"
import sys,time
def emit(event): print(json.dumps(event), flush=True)
session='fixture-session'
emit({'type':'system','subtype':'init','cwd':root,'tools':['Read'],'mcp_servers':[],'permissionMode':'dontAsk','session_id':session})
for path in ['scope.json','patch.diff']:
    emit({'type':'assistant','session_id':session,'message':{'content':[{'type':'tool_use','id':path,'name':'Read','input':{'file_path':path}}]}})
    emit({'type':'user','session_id':session,'message':{'content':[{'type':'tool_result','tool_use_id':path,'content':'Snapshot evidence'}]},'tool_use_result':{'type':'text','file':{'filePath':os.path.join(root,path),'content':'Snapshot evidence'}}})
deadline=time.monotonic()+20
while not os.path.exists(os.environ['PROGRESS_RELEASE']) and time.monotonic()<deadline: time.sleep(0.02)
emit({'type':'assistant','session_id':session,'message':{'content':[{'type':'text','text':text}]}})
emit({'type':'result','session_id':session,'subtype':'success','is_error':False,'stop_reason':'end_turn','result':text})
"#;

#[test]
fn a_quiet_reviewer_reports_elapsed_time_with_its_observed_read_count() {
    let trial = fixture();
    slow_pi(&trial);
    let observed = live_run(&trial, "pi", "WAIT  Reviewer running:");
    assert!(observed.iter().any(|line| {
        line.starts_with("WAIT  Reviewer running: 2 evidence files inspected; ")
            && line.ends_with("s elapsed")
    }));
}
