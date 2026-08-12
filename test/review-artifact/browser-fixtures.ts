export function narrowLayoutExpression() {
  return `JSON.stringify((() => {
    const selectors = [".artifact-panel", ".conversation", "#message", ".actions"];
    const regionsVisible = selectors.every((selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth + 1;
    });
    return {
      bodyScrollable: getComputedStyle(document.body).overflowY === "auto",
      narrow: matchMedia("(max-width: 820px)").matches && innerWidth <= 480,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      regionsVisible,
    };
  })())`;
}

export function annotationArtifact() {
  return `<!doctype html><html><body><main tabindex="-1">Browser review target</main>
<script>
window.addEventListener("load", () => setTimeout(() => {
  parent.postMessage({ type: "review:queue", prompt: null }, "*");
  const target = document.querySelector("main");
  target.focus();
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  setTimeout(() => {
    const input = document.querySelector('[data-review-artifact-ui="card"] textarea');
    if (!input || document.activeElement !== input) return;
    input.value = "Tighten this browser-tested copy";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    setTimeout(() => selectText(target), 100);
  }, 150);
}, 300));
function selectText(target) {
  const range = document.createRange();
  range.setStart(target.firstChild, 0);
  range.setEnd(target.firstChild, 7);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  setTimeout(() => {
    const input = document.querySelector('[data-review-artifact-ui="card"] textarea');
    if (!input || document.activeElement !== input) return;
    input.value = "Rewrite the selected words";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    setTimeout(() => parent.postMessage({
      type: "review:snapshot", snapshot: 'main "Browser review target"',
    }, "*"), 100);
  }, 150);
}
</script></body></html>`;
}

export function decisionFormArtifact(completion: "approve" | "end" = "end") {
  const payload = completion === "approve"
    ? '{"action":"approve-as-is","selectedFindingIds":[]}'
    : '{"action":"fix-selected","selectedFindingIds":["review-1"]}';
  return `<!doctype html><title>Overnight Runner - Review Findings</title><main id="explore-target">Explore target</main>
<form id="review-decisions"><button id="submit-decisions" type="submit">Submit decisions</button></form><script>
document.querySelector("#explore-target").addEventListener("click", () => { document.body.dataset.explored = "yes"; });
document.querySelector("#review-decisions").addEventListener("submit", (event) => {
  event.preventDefault();
  parent.postMessage({
    type: "review:submit",
    completion: ${JSON.stringify(completion)},
    prompt: {
      prompt: ${JSON.stringify(payload)},
      selector: "#review-decisions",
      tag: "review-decisions",
      text: "Review decisions",
    },
  }, "*");
});
</script>`;
}

export function queueFloodArtifact() {
  return `<!doctype html><main>Queue target</main><script>
window.addEventListener("load", () => setTimeout(() => {
  for (let index = 0; index < 101; index += 1) {
    parent.postMessage({
      type: "review:queue",
      prompt: { prompt: "Queued " + index, selector: "main", tag: "main", text: "Queue target" },
    }, "*");
  }
  setTimeout(() => parent.postMessage({ type: "review:snapshot", snapshot: "main" }, "*"), 100);
}, 300));
</script>`;
}

export function scrollArtifact(label: string) {
  return `<!doctype html><style>body{height:2400px}</style><main>${label}</main>
<script>
window.addEventListener("load", () => setTimeout(() => {
  const reload = new URL(location.href).searchParams.has("reload");
  if (!reload) {
    scrollTo(0, 400);
    return;
  }
  const observer = setInterval(() => {
    if (scrollY < 350) return;
    clearInterval(observer);
    parent.postMessage({
      type: "review:queue",
      prompt: { prompt: "observe:ok", selector: "main", tag: "message", text: "After reload" },
    }, "*");
    parent.postMessage({ type: "review:snapshot", snapshot: "restored" }, "*");
  }, 50);
}, 100));
</script>`;
}
