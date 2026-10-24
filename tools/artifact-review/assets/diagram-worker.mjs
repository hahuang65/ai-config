import { readFileSync } from 'node:fs';

const { engine, source, options } = JSON.parse(readFileSync(0, 'utf8'));
const { render } = await import(`data:text/javascript;base64,${Buffer.from(engine).toString('base64')}`);
process.stdout.write(render(source, {
  ...options, links: false, images: false, limit: 262144, outputLimit: 25 * 1024 * 1024,
}).svg);
