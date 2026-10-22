// PROTOTYPE — NOT PRODUCTION. Static evidence reports, never a replacement review shell.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtures } from './fixtures.mjs';

const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const css = `*{box-sizing:border-box}body{font:16px/1.5 Arial,sans-serif;color:#202432;background:#f5f7fb;margin:0 auto;padding:24px;max-width:1200px}
h1,h2,h3{line-height:1.2}section{margin:32px 0}figure{margin:16px 0;padding:16px;background:white;border:1px solid #9aa8bc;border-radius:8px;overflow:auto}
figure img{max-width:100%;height:auto;display:block}figcaption{margin-top:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e8edf5;padding:16px}
.table-scroll{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:8px;border-bottom:1px solid #abb6c7;text-align:left}a{color:#254e9d}.warning{border-left:5px solid #a74716;padding:12px;background:#fff2e8}.dark{background:#1e2030;color:#e8eaf2}.narrow{display:inline-block;vertical-align:top;width:min(100%,414px)}.svg-host{max-width:100%}.svg-host>div{max-width:100%}`;

function summary(results) {
  const rows = results.filter(r => r.theme === 'light').map(r => `<tr><td>${escape(r.fixture)}</td><td>${r.width}</td><td>${r.library}</td>
    <td>${r.minTextPixels}</td><td>${r.height}</td><td>${r.clipped.length}</td><td>${r.overlaps.length}</td><td>${escape(r.missingLabels.join(', ') || 'none')}</td></tr>`).join('');
  return `<h1>Pele and Mermaid.js comparison</h1><p class="warning"><strong>PROTOTYPE — NOT PRODUCTION.</strong>
  This evaluates rendering, not production integration or security.</p>
  <p>Pele 1.8.0 and Mermaid.js 12.1.0 render identical synthetic sources in Firefox, using local Arial and matched light/dark colors.
  No external fonts, remote images, or CDN scripts load in the browser.</p>
  <h2>What the experiment established</h2>
  <p>Pele improves narrow workflow and sequence text sizes, but does not make either automatically readable.
  The baseline workflow still falls below 8 pixels at 380 pixels wide.
  Its narrow vertical chart omits Validation and Publication, so the baseline label-retention test remains red.</p>
  <p>Explicit narrow chart dimensions let Mermaid retain every category at 14 pixels.
  A horizontal chart lets Pele retain every category at 14 pixels too.
  This is a configuration and layout decision, not a universal renderer win.</p>
  <p><strong>Recommendation:</strong> investigate sanitized, pre-rendered static SVG support first.
  Keep document JavaScript disabled.
  Enforce readable text through layout, simplification, or natural-size scrolling rather than shrinking every diagram to fit.
  Select the renderer per diagram after visual comparison.</p>
  <h2>Measured light-theme results</h2><div class="table-scroll"><table><thead><tr><th>Fixture</th><th>Available width</th><th>Renderer</th><th>Smallest text, px</th><th>Height, px</th><th>Clipped labels</th><th>Text overlaps</th><th>Missing labels</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p>Text size includes the SVG display scale.
  Clipping means text extends beyond the SVG rectangle.
  Overlaps are intersecting text bounding boxes and need visual inspection.
  These checks do not prove that arrows avoid nodes or that the layout communicates well.</p>
  <p>Width-aware layout and uniform scaling trade readability against vertical space.
  Rendering speed is not an adoption criterion here.
  No authoring-time improvement has been measured.</p>
  <h2>Current review compatibility</h2><p>The separate capability probe fails because inline SVG disappears.
  The characterization checks test both libraries’ vector output, PNG conversion, and runtime script removal.
  The production sanitizer and iframe policy are unchanged.</p>`;
}

function figure(row, vector) {
  const content = vector ? `<div class="svg-host">${row.svg}</div>`
    : `<img src="${row.png}" width="${row.width}" alt="${escape(`${row.library}: ${row.fixture}, ${row.width}px ${row.theme} layout`)}">`;
  return `<figure class="${row.theme === 'dark' ? 'dark' : ''} ${row.width === 380 ? 'narrow' : ''}">
    <h3>${row.library === 'pele' ? 'Pele' : 'Mermaid.js'} · ${row.width}px · ${row.theme}</h3>${content}
    <figcaption>Minimum text: ${row.minTextPixels}px.
    Layout height: ${row.height}px.
    Clipped labels: ${row.clipped.length}.
    Text overlaps: ${row.overlaps.length}.
    Missing labels: ${escape(row.missingLabels.join(', ') || 'none')}.</figcaption></figure>`;
}

export async function writeReports(root, results, tuned = []) {
  for (const vector of [false, true]) {
    const sections = fixtures.map(fixture => {
      // 16 light images + 4 tuned images stay within the review runtime's 24-image limit.
      const rows = results.filter(r => r.fixture === fixture.id && (vector || r.theme === 'light'));
      return `<section id="${fixture.id}"><h2>${escape(fixture.title)}</h2><p>${escape(fixture.question)}</p>
        ${rows.map(r => figure(r, vector)).join('\n')}<h3>Shared source</h3><pre>${escape(fixture.source)}</pre></section>`;
    }).join('\n');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Diagram renderer comparison - ${vector ? 'Static vector inspection' : 'Rendering evaluation'}</title><style>${css}</style></head><body>
      ${summary(results)}${sections}<section><h2>Narrow chart configuration experiments</h2>
      <p>These are separate from the baseline comparison.
      All use explicit 380 by 360 pixel chart dimensions.
      The first pair retains a vertical chart, and the second changes the shared source to a horizontal chart.
      Configuration and orientation can matter as much as the renderer.</p>
      ${tuned.map(row => `<h3>${escape(row.id)}</h3>${figure(row, vector)}`).join('')}</section><h2>Limits and decision</h2><p>These four fixtures do not establish universal compatibility.
      A human should compare grouping, connector routing, category labels, contrast, and useful diagram density before selecting a renderer.
      Safe static SVG support and runtime JavaScript are separate integration decisions.</p></body></html>`;
    await writeFile(join(root, vector ? 'vectors.html' : 'comparison.html'), html);
  }
}
