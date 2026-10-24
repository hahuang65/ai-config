import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('./artifact-review/assets/diagram-engine.mjs', import.meta.url);
const destination = new URL('./artifact-review/target/pele.mjs', import.meta.url);
const result = await Bun.build({
  entrypoints: [fileURLToPath(source)],
  target: 'node', format: 'esm', minify: true,
});
if (!result.success || result.outputs.length !== 1) {
  throw new AggregateError(result.logs, 'Pele must build as one self-contained module');
}
const license = await readFile(new URL('../node_modules/pele/LICENSE', import.meta.url), 'utf8');
const bundle = `/*\n${license}\n*/\n${await result.outputs[0].text()}`;
await mkdir(new URL('./', destination), { recursive: true });
await writeFile(destination, bundle);
console.log('Built the bundled Pele engine with its license');
