pub const FAKE_PI: &str = r#"#!/usr/bin/env python3
import json, os, sys, time
root = os.environ['PI_REVIEW_ROOT']
with open(os.environ['EVALUATION_TEST_LOG'], 'a') as log:
    log.write(json.dumps({'args': sys.argv[1:], 'cwd': os.getcwd(), 'agentDir': os.environ.get('PI_CODING_AGENT_DIR'), 'path': os.environ['PATH'].split(os.pathsep)}) + '\n')
mode = os.environ.get('CONSULT_MODE', '')
if mode == 'wait':
    time.sleep(12)
    sys.exit(0)
if mode == 'malformed':
    print('fixture-private-diagnostic')
    sys.exit(0)
print(json.dumps({'type':'entry_appended','entry':{'customType':'review-scope-ready','data':{'root':root,'tools':['read']}}}))
reads = [os.environ.get('CONSULT_READ', 'after/source.txt')]
if mode != 'no-scope': reads.append('scope.json')
for name in reads:
    with open(os.path.join(root, name)) as source: source.read()
    print(json.dumps({'type':'tool_execution_start','toolCallId':name,'toolName':'read','args':{'path':name}}))
    print(json.dumps({'type':'tool_execution_end','toolCallId':name,'toolName':'read','isError': mode == 'failed-scope' and name == 'scope.json'}))
print(json.dumps({'type':'message_end','message':{'role':'assistant','stopReason':'stop','content':[{'type':'text','text':'Prefer a small interface. No tests executed.'}]}}))
if mode != 'no-settled': print(json.dumps({'type':'agent_settled'}))
if mode == 'nonzero':
    print('fixture-private-diagnostic', file=sys.stderr)
    sys.exit(7)
"#;
