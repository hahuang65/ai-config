(() => {
  "use strict";

  let annotationMode = true;
  let hovered = null;
  let locateTarget = null;
  let cardHost = null;
  let returnFocus = null;
  const ids = new WeakMap();
  let idCounter = 0;

  function uid(element) {
    if (!ids.has(element)) ids.set(element, String(++idCounter));
    return ids.get(element);
  }

  function selector(element) {
    if (!element?.tagName) return "";
    const parts = [];
    let current = element;
    while (current?.nodeType === 1 && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${CSS.escape(current.id)}`;
        parts.unshift(part);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  }

  function context(element) {
    return {
      uid: uid(element),
      selector: selector(element),
      tag: element.tagName?.toLowerCase() ?? "",
      text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 240),
    };
  }

  function isReviewUi(element) {
    return Boolean(element?.closest?.("[data-review-artifact-ui]"));
  }

  function isInteractive(element) {
    return Boolean(
      element?.closest?.(
        "button,input,select,textarea,label,summary,a[href],[contenteditable]:not([contenteditable='false']),[data-review-artifact-action]",
      ),
    );
  }

  function highlight(element) {
    if (!element) return;
    element.style.outline = "2px solid #b65c38";
    element.style.outlineOffset = "2px";
  }

  function clearHighlight(element) {
    if (!element) return;
    element.style.outline = "";
    element.style.outlineOffset = "";
  }

  function flashElement(element) {
    const originalOutline = element.style.outline;
    const originalOffset = element.style.outlineOffset;
    element.style.outline = "3px solid #d17a4d";
    element.style.outlineOffset = "3px";
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.outlineOffset = originalOffset;
    }, 1600);
  }

  function locateInArtifact(message) {
    clearHighlight(locateTarget);
    locateTarget = null;
    let element = null;
    if (message.selector) {
      try {
        element = document.querySelector(message.selector);
      } catch {
        element = null;
      }
    }
    if (!element) {
      parent.postMessage({ type: "review:locate-result", ok: false }, "*");
      return;
    }
    if (message.scroll) {
      flashElement(element);
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      locateTarget = element;
      highlight(element);
    }
    parent.postMessage({ type: "review:locate-result", ok: true }, "*");
  }

  function closestElement(node) {
    if (!node) return document.body;
    return node.nodeType === 1 ? node : node.parentElement || document.body;
  }

  function nodePath(node, root) {
    const parts = [];
    let current = node;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) break;
      parts.unshift([...parent.childNodes].indexOf(current));
      current = parent;
    }
    return parts;
  }

  function rangeBoundary(node, offset) {
    const element = closestElement(node);
    return { selector: selector(element), path: nodePath(node, element), offset: Number(offset) || 0 };
  }

  function selectedTextContext() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const text = selection.toString().trim().replace(/\s+/g, " ");
    if (range.collapsed || !text) return null;
    const element = closestElement(range.commonAncestorContainer);
    if (isReviewUi(element) || isInteractive(element)) return null;
    const commonSelector = selector(element);
    return {
      ...context(element),
      tag: "text",
      text: text.slice(0, 240),
      target: {
        type: "text-range",
        text,
        selector: commonSelector,
        start: rangeBoundary(range.startContainer, range.startOffset),
        end: rangeBoundary(range.endContainer, range.endOffset),
      },
      element,
      range: range.cloneRange(),
    };
  }

  function ensureCardHost() {
    if (cardHost?.isConnected) return cardHost;
    cardHost = document.createElement("div");
    cardHost.dataset.reviewArtifactUi = "annotation";
    cardHost.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    document.documentElement.appendChild(cardHost);
    return cardHost;
  }

  function closeCard() {
    if (cardHost) cardHost.replaceChildren();
    if (returnFocus?.isConnected && returnFocus !== document.body) returnFocus.focus();
    returnFocus = null;
  }

  function showCard(target) {
    closeCard();
    returnFocus = document.activeElement;
    const host = ensureCardHost();
    const card = document.createElement("form");
    card.dataset.reviewArtifactUi = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Annotation feedback");
    card.style.cssText = [
      "pointer-events:auto", "position:fixed", "right:18px", "bottom:18px", "width:min(340px,calc(100vw - 36px))",
      "padding:14px", "border:2px solid #b65c38", "border-radius:10px", "background:#1f211f", "color:#f7f2e8",
      "box-shadow:0 18px 60px rgba(0,0,0,.35)", "font:14px/1.45 system-ui,sans-serif",
    ].join(";");
    const heading = document.createElement("strong");
    heading.textContent = target.tag === "text" ? `Selected: ${target.text}` : `${target.tag}: ${target.text || target.selector}`;
    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.placeholder = "What should change?";
    textarea.style.cssText = "display:block;width:100%;margin:10px 0;padding:8px;box-sizing:border-box;font:inherit";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const queue = document.createElement("button");
    queue.type = "submit";
    queue.textContent = "Queue feedback";
    queue.style.marginInlineStart = "8px";
    card.append(heading, textarea, cancel, queue);
    host.append(card);
    cancel.addEventListener("click", closeCard);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCard();
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        card.requestSubmit();
      }
    });
    card.addEventListener("submit", (event) => {
      event.preventDefault();
      const prompt = textarea.value.trim();
      if (!prompt) return;
      parent.postMessage({
        type: "review:queue",
        prompt: { ...context(target.element), prompt, ...(target.target ? { target: target.target, tag: "text", text: target.text } : {}) },
      }, "*");
      window.getSelection()?.removeAllRanges();
      closeCard();
    });
    textarea.focus();
  }

  function reportScroll() {
    parent.postMessage({ type: "review:scroll", x: scrollX, y: scrollY }, "*");
  }

  function restoreScroll(message) {
    const x = boundedCoordinate(message.x);
    const y = boundedCoordinate(message.y);
    if (x === null || y === null) return;
    scrollTo(x, y);
    reportScroll();
  }

  function boundedCoordinate(value) {
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000_000
      ? value
      : null;
  }

  function snapshot() {
    const lines = [];
    function walk(element, depth) {
      if (!(element instanceof Element) || depth > 6 || isReviewUi(element)) return;
      const details = context(element);
      const text = details.text ? ` "${details.text.slice(0, 80).replaceAll('"', "'")}"` : "";
      lines.push(`${"  ".repeat(depth)}${details.tag}${text}`);
      for (const child of element.children) walk(child, depth + 1);
    }
    walk(document.body, 0);
    return lines.join("\n").slice(0, 100_000);
  }

  document.addEventListener("mouseover", (event) => {
    if (!annotationMode || isReviewUi(event.target) || isInteractive(event.target)) return;
    clearHighlight(hovered);
    if (locateTarget && locateTarget !== event.target) clearHighlight(locateTarget);
    hovered = event.target;
    highlight(hovered);
  }, true);

  document.addEventListener("mouseout", (event) => {
    if (event.target === hovered) {
      clearHighlight(hovered);
      hovered = null;
    }
  }, true);

  document.addEventListener("mouseup", () => {
    if (!annotationMode) return;
    const selected = selectedTextContext();
    if (selected) showCard(selected);
  }, true);

  document.addEventListener("click", (event) => {
    if (!annotationMode || isReviewUi(event.target) || isInteractive(event.target) || selectedTextContext()) return;
    event.preventDefault();
    event.stopPropagation();
    showCard({ ...context(event.target), element: event.target });
  }, true);

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    if (event.data?.type === "review:set-mode") {
      annotationMode = Boolean(event.data.enabled);
      if (!annotationMode) closeCard();
    }
    if (event.data?.type === "review:request-snapshot") {
      parent.postMessage({ type: "review:snapshot", snapshot: snapshot() }, "*");
    }
    if (event.data?.type === "review:locate") {
      locateInArtifact(event.data);
    }
    if (event.data?.type === "review:locate-clear") {
      clearHighlight(locateTarget);
      locateTarget = null;
    }
    if (event.data?.type === "review:restore-scroll") restoreScroll(event.data);
  });

  let scrollFrame = null;
  window.addEventListener("scroll", () => {
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      reportScroll();
    });
  }, { passive: true });

  parent.postMessage({ type: "review:ready" }, "*");
  reportScroll();
  rootLayoutAudit();

  async function rootLayoutAudit() {
    const layout = globalThis.ReviewArtifactLayout;
    if (!layout?.stableAudit) return;
    const layoutWarnings = await layout.stableAudit();
    parent.postMessage({ type: "review:layout", layoutWarnings }, "*");
  }
})();
