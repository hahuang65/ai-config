# CSS Mermaid Patterns

Mermaid-specific patterns: containers, zoom controls, scaling, centering, and SVG connectors.

## Mermaid Containers

Mermaid diagrams have two common layout issues: they render too small to read, and they left-align in their container leaving awkward dead space (especially for narrow vertical flowcharts).

### Centering (Required)

Mermaid SVGs render at a fixed size based on content. Without explicit centering, they default to top-left alignment. **Always center Mermaid diagrams** — narrow vertical flowcharts look particularly bad when left-aligned in a wide container.

```css
/* WRONG — diagram hugs left edge */
.mermaid-container {
  padding: 24px;
  border: 1px solid var(--border);
}

/* RIGHT — diagram centers in container */
.mermaid-wrap {
  display: flex;
  justify-content: center;
  align-items: flex-start;  /* or center for shorter diagrams */
  padding: 24px;
  border: 1px solid var(--border);
}
```

### Scaling Small Diagrams

Mermaid sizes diagrams based on content, not container. Complex diagrams with many nodes render small to fit everything, leaving the text nearly unreadable. Three fixes:

**1. Increase fontSize in themeVariables** (most effective):
```javascript
mermaid.initialize({
  theme: 'base',
  themeVariables: {
    fontSize: '18px',  // default is 16px, bump to 18-20px for complex diagrams
  }
});
```

**2. CSS zoom** for diagrams that still render too small:
```css
.mermaid-wrap--scaled .mermaid {
  zoom: 1.3;
}
```

**3. Constrain container width** so the diagram doesn't float in dead space:
```css
.mermaid-wrap--constrained {
  max-width: 800px;
  margin: 0 auto;
}
```

**Rule of thumb:** If the diagram has 10+ nodes or the text is smaller than 12px rendered, increase fontSize to 18-20px or apply CSS zoom.

### Zoom Controls

Add zoom controls to every `.mermaid-wrap` container for complex diagrams.

**Small diagrams in slides.** If a diagram has fewer than ~7 nodes with no branching, it will render tiny in a full-viewport slide container. For simple linear flows (A → B → C → D), use CSS pipeline cards instead of Mermaid — see `slide-patterns.md` "CSS Pipeline Slide." Reserve Mermaid for complex graphs where automatic edge routing is actually needed.

### Full Pattern

```css
.mermaid-wrap {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px 24px;
  overflow: auto;
  /* CRITICAL: center the diagram both horizontally and vertically */
  display: flex;
  justify-content: center;
  align-items: center;
  /* Prevent vertical flowcharts from compressing into unreadable thumbnails */
  min-height: 400px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.mermaid-wrap::-webkit-scrollbar { width: 6px; height: 6px; }
.mermaid-wrap::-webkit-scrollbar-track { background: transparent; }
.mermaid-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
.mermaid-wrap::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

/* For shorter diagrams that don't need the full height */
.mermaid-wrap--compact { min-height: 200px; }

/* For very tall vertical flowcharts */
.mermaid-wrap--tall { min-height: 600px; }

.mermaid-wrap .mermaid {
  /* Use CSS zoom instead of transform: scale().
     Zoom changes actual layout size, so overflow scrolls normally in all directions.
     Transform only changes visual appearance — content expanding upward/leftward
     goes into negative space which can't be scrolled to.
     Supported in all browsers (Firefox added support in v126, June 2024).
     Note: zoom is not animatable, so no transition. */
  /* Optional: start at >1 for complex diagrams that render too small.
     The diagram stays centered, renders larger, and zoom controls still work. */
  zoom: 1.4;
}

.zoom-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
  z-index: 10;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
}

.zoom-controls button {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.zoom-controls button:hover {
  background: var(--border);
  color: var(--text);
}

.mermaid-wrap { cursor: grab; }
.mermaid-wrap.is-panning { cursor: grabbing; user-select: none; }
```

**Why zoom instead of transform?**

CSS `transform: scale()` only changes visual appearance — the element's layout box stays the same size. When you scale from `center center`, content expands upward and leftward into negative coordinate space. Scroll containers can't scroll to negative positions, so the top and left of the zoomed content get clipped.

CSS `zoom` actually changes the element's layout size. The content grows downward and rightward like any other growing element, staying fully scrollable.

### HTML

```html
<div class="mermaid-wrap">
  <div class="zoom-controls">
    <button onclick="zoomDiagram(this, 1.2)" title="Zoom in">+</button>
    <button onclick="zoomDiagram(this, 0.8)" title="Zoom out">&minus;</button>
    <button onclick="resetZoom(this)" title="Reset zoom">&#8634;</button>
  </div>
  <pre class="mermaid">
    graph TD
      A --> B
  </pre>
</div>
```

### JavaScript

Add once at the end of the page. Handles button clicks and scroll-to-zoom on all `.mermaid-wrap` containers:

```javascript
// Match this to the CSS zoom value (or 1 if not set)
var INITIAL_ZOOM = 1.4;

function zoomDiagram(btn, factor) {
  var wrap = btn.closest('.mermaid-wrap');
  var target = wrap.querySelector('.mermaid');
  var current = parseFloat(target.dataset.zoom || INITIAL_ZOOM);
  var next = Math.min(Math.max(current * factor, 0.5), 5);
  target.dataset.zoom = next;
  target.style.zoom = next;
}

function resetZoom(btn) {
  var wrap = btn.closest('.mermaid-wrap');
  var target = wrap.querySelector('.mermaid');
  target.dataset.zoom = INITIAL_ZOOM;
  target.style.zoom = INITIAL_ZOOM;
}

document.querySelectorAll('.mermaid-wrap').forEach(function(wrap) {
  // Ctrl/Cmd + scroll to zoom
  wrap.addEventListener('wheel', function(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    var target = wrap.querySelector('.mermaid');
    var current = parseFloat(target.dataset.zoom || INITIAL_ZOOM);
    var factor = e.deltaY < 0 ? 1.1 : 0.9;
    var next = Math.min(Math.max(current * factor, 0.5), 5);
    target.dataset.zoom = next;
    target.style.zoom = next;
  }, { passive: false });

  // Click-and-drag to pan
  var startX, startY, scrollL, scrollT;
  wrap.addEventListener('mousedown', function(e) {
    if (e.target.closest('.zoom-controls')) return;
    wrap.classList.add('is-panning');
    startX = e.clientX;
    startY = e.clientY;
    scrollL = wrap.scrollLeft;
    scrollT = wrap.scrollTop;
  });
  window.addEventListener('mousemove', function(e) {
    if (!wrap.classList.contains('is-panning')) return;
    wrap.scrollLeft = scrollL - (e.clientX - startX);
    wrap.scrollTop = scrollT - (e.clientY - startY);
  });
  window.addEventListener('mouseup', function() {
    wrap.classList.remove('is-panning');
  });
});
```

Scroll-to-zoom requires Ctrl/Cmd+scroll to avoid hijacking normal page scroll. Cursor changes to `grab`/`grabbing` to signal pan mode. The zoom range is capped at 0.5x–5x.

## Connectors

### CSS Arrow (vertical, between stacked sections)
```css
.flow-arrow {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 6px 0;
}

/* Down arrow via SVG icon */
.flow-arrow svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: var(--border-bright);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

Down arrow SVG (reuse inline):
```html
<svg viewBox="0 0 20 20"><path d="M10 4 L10 16 M6 12 L10 16 L14 12"/></svg>
```

### CSS Arrow (horizontal, between inline steps)
Use `::after` or a literal arrow character:
```css
.h-arrow::after {
  content: '→';
  color: var(--border-bright);
  font-size: 18px;
  padding: 0 4px;
}
```

### SVG Curved Connector (between arbitrary nodes)
For connections that aren't simple vertical/horizontal, use an absolutely positioned SVG overlay:
```html
<svg class="connectors" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">
  <path d="M 150,100 C 150,200 350,100 350,200" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 3"/>
  <!-- Arrowhead -->
  <polygon points="348,195 352,205 356,195" fill="var(--accent)"/>
</svg>
```

Position the parent container as `position: relative` to scope the SVG overlay.
