"use strict";

const CHANGE_HOST = "changes";
let presentedRegions = [];
let activeIndex = -1;

export function presentChangedRegions(regions, root = document.body) {
  clearChangedRegions(root.ownerDocument);
  if (regions.length === 0) return;
  const host = createHost(root.ownerDocument);
  presentedRegions = regions.flatMap((region) => {
    const target = resolvePath(root, region.path);
    if (!target) return [];
    const overlay = createOverlay(target, region);
    host.append(overlay);
    return [{ overlay, target }];
  });
}

export function activateChangedRegion(direction) {
  if (presentedRegions.length === 0) return;
  activeIndex = nextActiveIndex(direction, activeIndex, presentedRegions.length);
  presentedRegions.forEach(({ overlay }, index) => setActive(overlay, index === activeIndex));
  presentedRegions[activeIndex].target.scrollIntoView({
    block: "center",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

function nextActiveIndex(direction, current, count) {
  if (direction === "previous") return current < 0 ? count - 1 : (current - 1 + count) % count;
  return current < 0 ? 0 : (current + 1) % count;
}

export function clearChangedRegions(documentRef = document) {
  documentRef.querySelector(`[data-review-artifact-ui="${CHANGE_HOST}"]`)?.remove();
  presentedRegions = [];
  activeIndex = -1;
}

function createHost(documentRef) {
  const host = documentRef.createElement("div");
  host.dataset.reviewArtifactUi = CHANGE_HOST;
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all:initial;position:absolute;inset:0;z-index:2147483645;pointer-events:none";
  documentRef.documentElement.append(host);
  return host;
}

function createOverlay(target, region) {
  const rect = target.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.dataset.reviewArtifactChange = region.kind;
  overlay.dataset.reviewArtifactTarget = target === document.body ? "page" : target.id || "";
  overlay.style.cssText = [
    "all:initial", "position:absolute", `left:${rect.left + scrollX}px`, `top:${rect.top + scrollY}px`,
    `width:${rect.width}px`, `height:${rect.height}px`, "box-sizing:border-box", "pointer-events:none",
    "background:rgba(196,49,132,.08)",
    "box-shadow:none",
  ].join(";");
  overlay.append(createBadge(region.kind));
  return overlay;
}

function setActive(overlay, active) {
  overlay.toggleAttribute("data-review-change-active", active);
  overlay.style.background = active ? "rgba(196,49,132,.14)" : "rgba(196,49,132,.08)";
  overlay.style.boxShadow = active ? "inset 0 0 0 2px rgba(196,49,132,.75)" : "none";
}

function createBadge(kind) {
  const badge = document.createElement("span");
  badge.dataset.reviewArtifactUi = "change-badge";
  badge.textContent = labelFor(kind);
  badge.style.cssText = [
    "all:initial", "position:absolute", "top:-12px", "right:8px", "padding:3px 7px",
    "border:1px solid #c43184", "border-radius:3px", "background:#ffe0f2", "color:#6f1748",
    "font:700 11px/1.2 ui-monospace,monospace", "pointer-events:none",
  ].join(";");
  return badge;
}

function resolvePath(root, path) {
  let current = root;
  for (const index of path) {
    current = current?.children[index];
    if (!current) return null;
  }
  return current;
}

function labelFor(kind) {
  if (kind === "updated-moved") return "Updated and moved";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
