((root) => {
  "use strict";

  const MATERIAL_ESCAPE_PX = 24;
  const MIN_MEANINGFUL_AREA = 64;
  const MAX_ELEMENTS = 2500;

  function classifyRectEscape({ rect, viewportWidth, meaningful }) {
    if (!meaningful || !rect || rect.width === 0 || rect.height === 0) return null;
    const leftOverflow = Math.max(0, -rect.left);
    const rightOverflow = Math.max(0, rect.right - viewportWidth);
    const overflowPx = Math.round(Math.max(leftOverflow, rightOverflow));
    if (overflowPx < MATERIAL_ESCAPE_PX) return null;
    return { kind: "escaped-content", axis: "horizontal", overflowPx };
  }

  function classifyTextOverflow({ scrollWidth, clientWidth, scrollHeight, clientHeight, style }) {
    if (!style || isExplicitTruncation(style)) return null;
    const horizontal = Math.round(scrollWidth - clientWidth);
    const vertical = Math.round(scrollHeight - clientHeight);
    const clipsX = new Set(["hidden", "clip"]).has(style.overflowX);
    const clipsY = new Set(["hidden", "clip"]).has(style.overflowY);
    if (clipsX && horizontal >= MATERIAL_ESCAPE_PX) {
      return { kind: "clipped-text", axis: "horizontal", overflowPx: horizontal };
    }
    if (clipsY && vertical >= MATERIAL_ESCAPE_PX) {
      return { kind: "clipped-text", axis: "vertical", overflowPx: vertical };
    }
    return null;
  }

  function classifyOcclusion({ required, coveredSamples, totalSamples }) {
    if (!required || totalSamples < 3 || coveredSamples / totalSamples < 0.8) return null;
    return { kind: "occluded-control", overflowPx: 0 };
  }

  function isExplicitTruncation(style) {
    return (
      style.textOverflow === "ellipsis" ||
      Boolean(style.webkitLineClamp && style.webkitLineClamp !== "none") ||
      style.whiteSpace === "nowrap" && style.overflowX === "hidden"
    );
  }

  function isMeaningful(element, rect, style) {
    if (rect.width * rect.height < MIN_MEANINGFUL_AREA) return false;
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (element.closest("[aria-hidden='true'],[hidden],[data-review-artifact-ui]")) return false;
    const text = (element.innerText || element.textContent || "").trim();
    return Boolean(text || element.matches("button,input,select,textarea,img,svg,canvas,[role='button']"));
  }

  function selector(element) {
    if (element.id) return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
    const parts = [];
    let current = element;
    while (current?.nodeType === 1 && parts.length < 4) {
      let part = current.tagName.toLowerCase();
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

  function collectFindings(documentRef = document, windowRef = window) {
    const findings = [];
    const viewportWidth = windowRef.innerWidth;
    const elements = [...documentRef.body.querySelectorAll("*")].slice(0, MAX_ELEMENTS);
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = windowRef.getComputedStyle(element);
      const intentionallyContained = isIntentionallyContained(element, windowRef, documentRef);
      const meaningful = isMeaningful(element, rect, style) && !intentionallyContained;
      const escaped = classifyRectEscape({ rect, viewportWidth, meaningful });
      if (escaped) findings.push(finding(element, escaped, viewportWidth));
      const occluded = classifyElementOcclusion(element, rect, documentRef, windowRef);
      if (occluded) findings.push(finding(element, occluded, viewportWidth));
      if (!meaningful || intentionallyContained || !hasDirectText(element)) continue;
      const clipped = classifyTextOverflow({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        style,
      });
      if (clipped) findings.push(finding(element, clipped, viewportWidth));
      if (findings.length >= 50) break;
    }
    return deduplicate(findings);
  }

  function classifyElementOcclusion(element, rect, documentRef, windowRef) {
    const required = element.matches("button,input,select,textarea,[role='button'],[data-required-control]");
    if (!required || rect.bottom <= 0 || rect.top >= windowRef.innerHeight) return null;
    const inset = Math.min(4, rect.width / 4, rect.height / 4);
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset],
    ].filter(([x, y]) => x >= 0 && x < windowRef.innerWidth && y >= 0 && y < windowRef.innerHeight);
    const coveredSamples = points.filter(([x, y]) => {
      const top = documentRef.elementFromPoint(x, y);
      return top && top !== element && !element.contains(top);
    }).length;
    return classifyOcclusion({ required, coveredSamples, totalSamples: points.length });
  }

  function isIntentionallyContained(element, windowRef, documentRef) {
    if (element.closest("[data-review-layout-intentional]")) return true;
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== documentRef.body) {
      const style = windowRef.getComputedStyle(ancestor);
      if (new Set(["auto", "scroll"]).has(style.overflowX) || new Set(["auto", "scroll"]).has(style.overflowY)) {
        return true;
      }
      if (style.clipPath && style.clipPath !== "none") return true;
      if (style.maskImage && style.maskImage !== "none") return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  function hasDirectText(element) {
    return [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
  }

  function finding(element, classified, viewportWidth) {
    return {
      selector: selector(element),
      ...classified,
      viewportWidth,
      severity: "error",
      persistent: false,
    };
  }

  function deduplicate(findings) {
    const unique = new Map();
    for (const entry of findings) {
      const key = `${entry.kind}:${entry.selector}:${entry.axis}`;
      if (!unique.has(key) || unique.get(key).overflowPx < entry.overflowPx) unique.set(key, entry);
    }
    return [...unique.values()];
  }

  async function stableAudit({ settleMs = 180, sampleMs = 120 } = {}) {
    await waitForFonts();
    await delay(settleMs);
    const first = collectFindings();
    await delay(sampleMs);
    const second = collectFindings();
    const firstKeys = new Set(first.map(findingKey));
    return second.filter((entry) => firstKeys.has(findingKey(entry)));
  }

  function findingKey(entry) {
    return `${entry.kind}:${entry.selector}:${entry.axis}:${Math.round(entry.overflowPx / MATERIAL_ESCAPE_PX)}`;
  }

  async function waitForFonts() {
    try {
      await Promise.race([document.fonts?.ready ?? Promise.resolve(), delay(2000)]);
    } catch {
      // Font readiness is best-effort; stable geometry sampling still follows.
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  root.ReviewArtifactLayout = Object.freeze({
    classifyOcclusion,
    classifyRectEscape,
    classifyTextOverflow,
    collectFindings,
    stableAudit,
  });
})(globalThis);
