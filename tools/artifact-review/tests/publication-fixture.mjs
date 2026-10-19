import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, execute, changeBinary, modelServer, configureModel, repository, calls, answer } from '../../../test/fixtures/reviewer.mjs';

const artifactBinary = resolve(import.meta.dirname, '../target/debug/review-artifact');

export async function publicationFixture(t, options = {}) {
  const f = fixture(root => t.after(() => rm(root, { recursive: true, force: true })));
  const repo = await repository(f);
  const git = async ref => (await execute('git', ['-C', repo, 'rev-parse', ref], { env: f.env })).stdout.trim();
  const state = join(f.root, 'provider.json');
  await writeFile(state, JSON.stringify({ base: await git('HEAD~1'), head: await git('HEAD'), posts: 0, reviews: [] }));
  const bin = join(f.root, 'publication-bin');
  await mkdir(bin);
  await writeFile(join(bin, 'gh'), PROVIDER, { mode: 0o755 });
  const env = { ...f.env, PATH: `${bin}:${f.env.PATH}`, PUBLICATION_FIXTURE: state, AR_ROOT: join(f.root, 'reviews') };
  const proposed = JSON.parse(answer);
  if (options.line !== undefined) proposed.findings[0].line = options.line;
  proposed.findings.push({ ...proposed.findings[0], title: 'Second finding' });
  for (let index = 2; index < (options.count ?? 2); index++) {
    proposed.findings.push({ ...proposed.findings[0], title: `Finding ${index + 1}` });
  }
  const { server } = modelServer(f.root, { answer: JSON.stringify(proposed), calls: calls(['scope.json', 'patch.diff'].map(path => ['read', { path }])) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let receipt;
  try {
    configureModel(f.profile, server.address().port);
    receipt = JSON.parse((await execute(changeBinary, ['--root', f.evaluation, 'review', 'pr',
      'https://github.com/fixture/repo/pull/7', '--repo', repo, '--intent', 'Fixture',
      '--provider', 'reviewer-fixture', '--model', 'fixture-model', '--thinking', 'off', '--json'],
    { cwd: f.root, env, timeout: 20000, maxBuffer: 1024 * 1024 })).stdout);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  const cli = async (...args) => JSON.parse((await execute(artifactBinary, args,
    { env, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout);
  t.after(() => cli('stop', receipt.report).catch(() => {}));
  await cli('open', receipt.report, '--findings', receipt.record, '--no-browser');
  const [directory] = await readdir(env.AR_ROOT);
  if (options.legacyHistory) {
    await cli('stop', receipt.report);
    await legacyHistory(join(env.AR_ROOT, directory, 'events.sqlite'), receipt.record);
    await cli('open', receipt.report, '--findings', receipt.record, '--no-browser');
  }
  const descriptor = JSON.parse(await readFile(join(env.AR_ROOT, directory, 'server.json'), 'utf8'));
  const api = async (route, body, headers = {}) => {
    const origin = `http://127.0.0.1:${descriptor.port}`;
    return fetch(origin + route, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${descriptor.capability}`, Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined });
  };
  const selection = async ids => {
    const info = await (await api('/publication')).json();
    return { account: info.account, base: info.base, head: info.head,
      comments: ids.map(id => ({ id, body: info.items.find(item => item.id === id)?.body || 'Fixture comment' })) };
  };
  return { ...f, ...receipt, cli, descriptor, state, api, selection,
    provider: async () => JSON.parse(await readFile(state, 'utf8')) };
}

async function legacyHistory(file, record) {
  const database = new DatabaseSync(file);
  try {
    const binding = JSON.parse(database.prepare('SELECT findings FROM configuration WHERE id=1').get().findings);
    delete binding.publication_only;
    database.prepare('UPDATE configuration SET findings=? WHERE id=1').run(JSON.stringify(binding));
    const report = JSON.parse(await readFile(record, 'utf8'));
    const event = { id: 'legacy-pr-accept-0001', action: 'accept', revision: report.html_digest,
      message: 'Historical PR acceptance', annotations: [], finding: 'F1' };
    database.prepare('INSERT INTO events(id,payload,action) VALUES(?,?,?)').run(event.id, JSON.stringify(event), event.action);
  } finally { database.close(); }
}

const PROVIDER = `#!/usr/bin/env python3
import json,os,sys,time
path=os.environ['PUBLICATION_FIXTURE']
p=json.load(open(path)); a=sys.argv[1:]; endpoint=a[1].split('?')[0]
deadline=time.monotonic()+10
while p.get('hold') and time.monotonic()<deadline:
 time.sleep(0.02); p=json.load(open(path))
if p.get('unavailable') or p.get('hold'): sys.exit(7)
if endpoint == 'repos/fixture/repo/pulls/7':
 print(json.dumps({'id':70,'number':7,'html_url':'https://github.com/fixture/repo/pull/7','state':'open','base':{'sha':p['base'],'repo':{'id':9,'full_name':'fixture/repo'}},'head':{'sha':p['head']}}))
elif endpoint.endswith('/files'):
 print(json.dumps([{'filename':'source.txt','status':'modified','patch':'@@ -1 +1 @@\\n-before\\n+after'}]))
elif endpoint == 'user': print(json.dumps({'id':p.get('actor',91),'login':'fixture-user'}))
elif '--method' in a:
 payload=json.load(open(a[a.index('--input')+1])); p['posts']+=1
 review=dict(payload,id=42,state='COMMENTED',user={'id':91})
 p['reviews'].append(review); json.dump(p,open(path,'w'))
 if p.get('lose'): sys.exit(7)
 print(json.dumps(review))
elif endpoint.endswith('/reviews'): print(json.dumps(p['reviews']))
elif endpoint.startswith('repos/fixture/repo/pulls/comments/'):
 identifier=int(endpoint.rsplit('/',1)[1]); source=p['reviews'][0]['comments'][identifier-100]
 comment=dict(source,id=identifier,pull_request_review_id=42,original_line=source['line'],original_commit_id=p['reviews'][0]['commit_id'])
 comment.update(p.get('detail',{})); p['detail_reads']=p.get('detail_reads',0)+1; json.dump(p,open(path,'w'))
 print(json.dumps(comment))
elif endpoint.endswith('/comments'):
 # The real per-review endpoint returns legacy diff positions, not line/side fields.
 print(json.dumps([dict(id=100+i,pull_request_review_id=42,path=c['path'],body=c['body'],position=i+1,original_commit_id=p['reviews'][0]['commit_id']) for i,c in enumerate(p['reviews'][0]['comments'])]))
else: sys.exit(9)
`;
