// PROTOTYPE — NOT PRODUCTION. Browser-only adapter, never loaded by a review artifact.
const colors = {
  light: { bg: '#ffffff', fg: '#202432', muted: '#555b6a', surface: '#eef2f8', border: '#69758a', accent: '#3155ac' },
  dark: { bg: '#1e2030', fg: '#e8eaf2', muted: '#b5bcd0', surface: '#30364e', border: '#8894b6', accent: '#8db1ff' },
};

function configure(theme, config) {
  const c = colors[theme];
  document.body.style.cssText = `margin:0;background:${c.bg};color:${c.fg};font:16px Arial`;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base',
    fontFamily: 'Arial', htmlLabels: false,
    themeVariables: { darkMode: theme === 'dark', background: c.bg, primaryColor: c.surface,
      primaryTextColor: c.fg, primaryBorderColor: c.border, lineColor: c.fg,
      secondaryColor: c.surface, tertiaryColor: c.bg, edgeLabelBackground: c.bg,
      fontFamily: 'Arial', fontSize: '16px', textColor: c.fg,
      xyChart: { backgroundColor: c.bg, titleColor: c.fg, xAxisLabelColor: c.muted,
        yAxisLabelColor: c.muted, xAxisTitleColor: c.fg, yAxisTitleColor: c.fg,
        xAxisLineColor: c.border, yAxisLineColor: c.border, plotColorPalette: '#4c78a8,#f58518' } },
    flowchart: { htmlLabels: false }, ...config,
  });
  return c;
}

function metrics(svg) {
  const bounds = svg.getBoundingClientRect();
  const texts = [...svg.querySelectorAll('text')].filter(el => el.textContent.trim()).map(el => {
    const rect = el.getBoundingClientRect(), matrix = el.getScreenCTM();
    const font = parseFloat(getComputedStyle(el).fontSize);
    return { label: el.textContent.trim(), x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      pixels: +(font * Math.hypot(matrix.a, matrix.b)).toFixed(2) };
  });
  const clipped = texts.filter(r => r.x < bounds.x - 2 || r.y < bounds.y - 2
    || r.x + r.width > bounds.right + 2 || r.y + r.height > bounds.bottom + 2).map(r => r.label);
  const overlaps = [];
  for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
    const x = texts[a], y = texts[b];
    if (Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > 2
      && Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > 2) {
      overlaps.push([x.label, y.label]);
    }
  }
  return { width: +bounds.width.toFixed(1), height: +bounds.height.toFixed(1),
    viewBox: svg.getAttribute('viewBox'), minTextPixels: Math.min(...texts.map(t => t.pixels)),
    clipped, overlaps, text: texts.map(t => t.label).join(' '), textCount: texts.length,
    foreignObjects: svg.querySelectorAll('foreignObject').length,
    activeElements: svg.querySelectorAll('script, image, a').length };
}

async function rasterize(svg, c, width, height) {
  // SVG as an image cannot inherit CSS variables from its HTML parent.
  const copy = svg.cloneNode(true);
  const live = [svg, ...svg.querySelectorAll('*')], clones = [copy, ...copy.querySelectorAll('*')];
  const properties = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight',
    'font-style', 'opacity', 'fill-opacity', 'stroke-opacity', 'color', 'rx'];
  for (let i = 0; i < live.length; i++) for (const property of properties) {
    clones[i].style.setProperty(property, getComputedStyle(live[i]).getPropertyValue(property));
  }
  copy.setAttribute('width', width); copy.setAttribute('height', height);
  const standalone = new XMLSerializer().serializeToString(copy);
  const image = new Image();
  image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(standalone)))}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * 2); canvas.height = Math.ceil(height * 2);
  const context = canvas.getContext('2d');
  context.fillStyle = c.bg; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

window.renderFixture = async ({ library, fixture, width, theme, config = {} }) => {
  document.querySelector('#host')?.remove();
  const c = configure(theme, config);
  const host = document.createElement('div'); host.id = 'host'; host.style.width = `${width}px`;
  host.style.cssText += `;--pele-bg:${c.bg};--pele-fg:${c.fg};--pele-muted:${c.muted};--pele-line:${c.fg};
    --pele-surface:${c.surface};--pele-surface-alt:${c.surface};--pele-border:${c.border};--pele-accent:${c.accent};--pele-font:Arial`;
  document.body.append(host);
  const start = performance.now();
  const svg = library === 'pele'
    ? pele.render(fixture.source, { maxWidth: width, fontFamily: 'Arial', links: false, images: false,
      idPrefix: `${fixture.id}-${width}-${theme}`, config }).svg
    : (await mermaid.render(`m-${fixture.id}-${width}-${theme}`, fixture.source)).svg;
  const renderMilliseconds = performance.now() - start;
  host.innerHTML = svg;
  await document.fonts.ready;
  const element = host.querySelector('svg');
  const result = metrics(element);
  return { ...result, renderMilliseconds, svg: host.outerHTML.replace('id="host"', 'class="generated-diagram"'),
    png: await rasterize(element, c, result.width, result.height) };
};
window.evaluationReady = true;
