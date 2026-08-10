import { validateChatEntries } from "./assets/message-validation.js";

export function renderReviewShell(session) {
  const sessionJson = escapeJsonScript(JSON.stringify({
    key: session.key,
    file: session.file,
    mode: session.mode,
    initialChat: validateChatEntries(session.chat),
  }));
  const annotating = session.mode !== "explore";
  const modeLabel = annotating ? "Annotate" : "Explore";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Review Artifact</title>
  <link rel="stylesheet" href="/shell.css">
</head>
<body>
  <header class="toolbar">
    <strong>Review Artifact</strong>
    <label class="theme-control" for="theme">
      <span>Theme</span>
      <select id="theme" name="theme" aria-label="Review theme">
        <option value="catppuccin-mocha" selected>Catppuccin Mocha</option>
        <option value="catppuccin-latte">Catppuccin Latte</option>
        <option value="dracula">Dracula</option>
        <option value="nord">Nord</option>
        <option value="tokyo-night">Tokyo Night</option>
        <option value="gruvbox-dark">Gruvbox Dark</option>
      </select>
    </label>
    <span id="presence" aria-live="polite">Agent not listening</span>
    <button id="mode" type="button" aria-pressed="${annotating}">${modeLabel}</button>
  </header>
  <main class="layout">
    <section class="artifact-panel" aria-label="Artifact under review">
      <div class="change-bar" data-review-change-bar hidden>
        <strong data-review-change-count></strong>
        <button type="button" data-review-change-action="previous">Previous</button>
        <button type="button" data-review-change-action="next">Next</button>
        <button type="button" data-review-change-action="dismiss">Dismiss</button>
      </div>
      <iframe id="artifact" title="Artifact under review" sandbox="allow-scripts allow-forms" src="/artifact/${session.key}/index.html"></iframe>
    </section>
    <aside class="conversation" aria-label="Review conversation">
      <h1>Conversation</h1>
      <div id="messages" aria-live="polite"></div>
      <div id="queued"></div>
      <label for="message">Feedback</label>
      <textarea id="message" rows="4"></textarea>
      <div class="actions">
        <button id="end" type="button">End review</button>
        <button id="approve" type="button">Approve</button>
        <button id="send" type="button">Send feedback</button>
      </div>
    </aside>
  </main>
  <div class="layout-gate" id="layout-gate" role="status">
    <div><h2 id="layout-gate-title">Checking layout</h2><p id="layout-gate-copy">Waiting for stable browser geometry before review.</p><button id="show-anyway" type="button">Show anyway</button></div>
  </div>
  <script id="review-session" type="application/json">${sessionJson}</script>
  <script type="module" src="/shell.js"></script>
</body>
</html>`;
}

export function injectBridge(html, key) {
  const scripts = [
    '<script src="/layout-audit.js"></script>',
    `<script type="module" src="/bridge.js?key=${encodeURIComponent(key)}"></script>`,
  ].join("");
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${scripts}</body>`);
  return `${html}\n${scripts}`;
}

function escapeJsonScript(value) {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}
