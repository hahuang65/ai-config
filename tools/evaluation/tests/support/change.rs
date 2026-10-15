use super::*;

pub fn command(trial: &Trial) -> Command {
    let original = trial.command();
    let mut review = Command::new(env!("CARGO_BIN_EXE_review-change"));
    for (key, value) in original.get_envs() {
        match value {
            Some(value) => {
                review.env(key, value);
            }
            None => {
                review.env_remove(key);
            }
        }
    }
    review.args(["--root"]).arg(&trial.root);
    review
}

pub fn git(trial: &Trial, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(trial.temporary.path().join("repo"))
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

pub fn fixture() -> Trial {
    let trial = Trial::new();
    trial.install();
    put(trial.temporary.path().join("repo/source.txt"), "before\n");
    git(&trial, &["init", "-b", "main"]);
    git(&trial, &["add", "source.txt"]);
    git(&trial, &["commit", "-m", "base"]);
    put(trial.temporary.path().join("repo/source.txt"), "after\n");
    git(&trial, &["commit", "-am", "change"]);
    executable(trial.fake_bin.join("pi"), MODEL);
    trial
}

pub fn review(trial: &Trial, target: &[&str]) -> Output {
    command(trial)
        .arg("review")
        .args(target)
        .args(["--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Replace before with after", "--json"])
        .output()
        .unwrap()
}

pub fn provider(trial: &Trial) -> PathBuf {
    let path = trial.temporary.path().join("provider.json");
    put(&path, json!({"base":git(trial, &["rev-parse", "HEAD~1"]),"head":git(trial, &["rev-parse", "HEAD"]),"reviews":[],"posts":0}).to_string());
    executable(trial.fake_bin.join("gh"), GITHUB);
    path
}

pub fn pull(trial: &Trial, provider: &Path) -> Value {
    let output = command(trial)
        .env("CHANGE_PROVIDER", provider)
        .env("CHANGE_TEST_MODE", "two")
        .args([
            "review",
            "pr",
            "https://github.com/fixture/repo/pull/7",
            "--repo",
        ])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "fixture", "--json"])
        .output()
        .unwrap();
    success(output.clone());
    serde_json::from_slice(&output.stdout).unwrap()
}

pub fn terminal(trial: &Trial, provider: &Path, report: &str, actions: &[&str]) -> Value {
    let script = trial.temporary.path().join("terminal.py");
    put(&script, TERMINAL);
    let original = command(trial);
    let mut command = Command::new("python3");
    for (key, value) in original.get_envs() {
        match value {
            Some(value) => {
                command.env(key, value);
            }
            None => {
                command.env_remove(key);
            }
        }
    }
    let output = command
        .env("CHANGE_PROVIDER", provider)
        .env("TTY_ACTIONS", serde_json::to_string(actions).unwrap())
        .arg(script)
        .arg(env!("CARGO_BIN_EXE_review-change"))
        .arg("--root")
        .arg(&trial.root)
        .args(["post", report])
        .output()
        .unwrap();
    success(output.clone());
    serde_json::from_slice(&output.stdout).unwrap()
}

pub const MODEL: &str = r#"#!/usr/bin/env python3
import os, json
root = os.environ['PI_REVIEW_ROOT']
mode = os.environ.get('CHANGE_TEST_MODE', '')
answer = {'summary':'A scoped review.', 'risk':'medium', 'uncertainties':['No tests executed.'], 'findings':[{'severity':'medium','title':'<script>bad</script>','body':'Check the behavior.','path':'source.txt','line':1,'side':'RIGHT'}]}
if os.environ.get('CHANGE_TEST_KIND'): answer['findings'][0]['kind'] = os.environ['CHANGE_TEST_KIND']
if mode == 'unchanged-suggestion': answer['findings'][0]['line'] = 99
if mode == 'two': answer['findings'].append(dict(answer['findings'][0], title='Excluded finding'))
if mode == 'destination': answer['repository'] = 'elsewhere/repo'
if mode == 'control': answer['summary'] = '\x1b[2J'
if mode == 'unsafe-path': answer['findings'][0]['path'] = '../outside'
text = 'not JSON' if mode == 'malformed' else json.dumps(answer)
print(json.dumps({'type':'entry_appended','entry':{'customType':'review-scope-ready','data':{'root':root,'tools':['read']}}}))
if mode != 'no-evidence':
    for name in ['scope.json', 'patch.diff']:
        print(json.dumps({'type':'tool_execution_start','toolCallId':name,'toolName':'read','args':{'path':name}}))
        print(json.dumps({'type':'tool_execution_end','toolCallId':name,'toolName':'read','isError':False}))
print(json.dumps({'type':'message_end','message':{'role':'assistant','stopReason':'stop','content':[{'type':'text','text':text}]}}))
print(json.dumps({'type':'agent_settled'}))
"#;

const GITHUB: &str = r#"#!/usr/bin/env python3
import sys, os, json
path = os.environ['CHANGE_PROVIDER']
p = json.load(open(path))
a = sys.argv[1:]
endpoint = a[1].split('?')[0]
if endpoint == 'repos/fixture/repo/pulls/7':
    print(json.dumps({'id':p.get('pull_id',70),'number':p.get('number',7),'html_url':p.get('url','https://github.com/fixture/repo/pull/7'),'state':p.get('state','open'),'base':{'sha':p['base'],'repo':{'id':p.get('repo_id',9),'full_name':'fixture/repo'}},'head':{'sha':p['head']}}))
elif endpoint.endswith('/files'):
    print(json.dumps(p.get('files', [{'filename':'source.txt','status':'modified','patch':'@@ -1 +1 @@\n-before\n+after'}])))
elif endpoint == 'user':
    if p.get('change_on_user'):
        p['head'] = 'b' * 40
        json.dump(p, open(path, 'w'))
    print(json.dumps({'id':91}))
elif '--method' in a and a[a.index('--method')+1] == 'POST':
    payload = json.load(open(a[a.index('--input')+1]))
    p['posts'] += 1
    review = dict(payload, id=42, state='COMMENTED', user={'id':91})
    p['reviews'].append(review)
    json.dump(p, open(path, 'w'))
    if p.get('lose'): sys.exit(7)
    print(json.dumps(review))
elif endpoint.endswith('/reviews'): print(json.dumps(p['reviews']))
elif endpoint.endswith('/comments'):
    comments = p['reviews'][0]['comments']
    print(json.dumps([dict(c, original_line=c['line'], original_commit_id=p['reviews'][0]['commit_id']) for c in comments]))
else: sys.exit(9)
"#;

const TERMINAL: &str = r#"import os, sys, json, subprocess, select, time, re, pty
master, slave = pty.openpty()
p = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
actions = json.loads(os.environ['TTY_ACTIONS'])
collected = b''
pending = b''
end = time.monotonic() + 12
while p.poll() is None and time.monotonic() < end:
    if not select.select([master], [], [], .05)[0]: continue
    try: chunk = os.read(master, 65536)
    except OSError: break
    collected += chunk
    pending += chunk
    if b'Selection> ' in pending:
        pending = b''
        os.write(master, (actions.pop(0)+'\n').encode() if actions else b'\x04')
    match = re.search(rb'Confirm by typing (POST [a-f0-9]{32}): ', pending)
    if match:
        answer = match[1]+b'\n'
        if actions and actions[0] == 'DECLINE': answer = b'no\n'
        if actions and actions[0] == 'EOF_CONFIRM': answer = b'\x04'
        os.write(master, answer)
        pending = b''
if p.poll() is None:
    try: p.wait(timeout=1)
    except subprocess.TimeoutExpired: p.kill(); p.wait()
os.close(master)
print(json.dumps({'code':p.returncode, 'output':collected.decode('utf-8','replace')}))
"#;
