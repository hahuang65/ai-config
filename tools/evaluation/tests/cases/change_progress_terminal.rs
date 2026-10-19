use crate::support::{change::*, *};
use std::process::Command;

#[test]
fn a_terminal_keeps_timestamped_logs_above_an_overall_stage_bar() {
    let trial = fixture();
    let script = trial.temporary.path().join("progress-terminal.py");
    put(&script, TERMINAL);
    let original = command(&trial);
    let mut wrapper = Command::new("python3");
    for (key, value) in original.get_envs() {
        if let Some(value) = value {
            wrapper.env(key, value);
        } else {
            wrapper.env_remove(key);
        }
    }
    let output = wrapper
        .arg(script)
        .arg(env!("CARGO_BIN_EXE_review-change"))
        .arg("--root")
        .arg(&trial.root)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--no-browser")
        .output()
        .unwrap();
    success(output.clone());
    let terminal: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(terminal["code"], 0);
    let log = terminal["log"].as_str().unwrap();
    assert!(log.contains("START Resolving review target"));
    assert!(log.contains("DONE  Resolving review target (elapsed "));
    assert!(log.contains("READ  scope.json"));
    assert!(
        log.contains("7/7 stages ·"),
        "No overall stage bar rendered"
    );
    assert!(log.contains("elapsed · Review complete"));
    assert!(
        terminal["result"]
            .as_str()
            .unwrap()
            .starts_with("1 findings. HTML report:")
    );
}

const TERMINAL: &str = r#"import os,sys,json,subprocess,select,time,pty,fcntl,termios,struct,re
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,120,0,0))
env=dict(os.environ,TERM='xterm-256color',NO_COLOR='1')
p=subprocess.Popen(sys.argv[1:],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=slave,env=env)
os.close(slave)
output=bytearray(); deadline=time.monotonic()+60
try:
 while time.monotonic()<deadline:
  readable,_,_=select.select([master],[],[],0.1)
  if readable:
   try: chunk=os.read(master,65536)
   except OSError: break
   if not chunk: break
   output.extend(chunk)
  elif p.poll() is not None: break
 if p.poll() is None: p.wait(timeout=5)
 result=p.communicate(timeout=5)[0].decode()
 text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',output.decode(errors='replace'))
 print(json.dumps({'code':p.returncode,'log':text,'result':result}))
finally:
 os.close(master)
 if p.poll() is None:
  p.terminate()
  try: p.wait(timeout=5)
  except subprocess.TimeoutExpired: p.kill(); p.wait()
"#;
