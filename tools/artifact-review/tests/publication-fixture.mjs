import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fixture, execute, changeBinary, modelServer, configureModel, repository, calls, answer } from '../../../test/fixtures/reviewer.mjs';

const artifactBinary = resolve(import.meta.dirname, '../target/debug/review-artifact');

export async function publicationFixture(t) {
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
  proposed.findings.push({ ...proposed.findings[0], title: 'Second finding' });
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
  const descriptor = JSON.parse(await readFile(join(env.AR_ROOT, directory, 'server.json'), 'utf8'));
  const api = async (route, body, headers = {}) => {
    const origin = `http://127.0.0.1:${descriptor.port}`;
    return fetch(origin + route, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${descriptor.capability}`, Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined });
  };
  return { ...f, ...receipt, cli, descriptor, state, api,
    provider: async () => JSON.parse(await readFile(state, 'utf8')) };
}

const PROVIDER = `#!/usr/bin/env python3
import json,os,sys
path=os.environ['PUBLICATION_FIXTURE']
p=json.load(open(path)); a=sys.argv[1:]; endpoint=a[1].split('?')[0]
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
elif endpoint.endswith('/comments'):
 print(json.dumps([dict(c,original_line=c['line'],original_commit_id=p['reviews'][0]['commit_id']) for c in p['reviews'][0]['comments']]))
else: sys.exit(9)
`;
