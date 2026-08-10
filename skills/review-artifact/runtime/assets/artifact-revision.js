"use strict";

const DEFAULT_LIMITS = Object.freeze({
  depth: 32,
  elements: 2_500,
  snapshotBytes: 2_000_000,
  text: 2_000,
});
const EXCLUDED_ELEMENTS = "script,style,meta,link,noscript,template";
const REVIEW_ATTRIBUTES = new Set([
  "alt", "checked", "disabled", "hidden", "href", "open", "placeholder", "role", "selected",
  "src", "title", "value", "data-status",
]);
const VISIBLE_STYLE_PROPERTIES = new Set([
  "display", "visibility", "opacity", "color", "background-color", "font-family", "font-size", "font-style",
  "font-weight", "line-height", "letter-spacing", "text-decoration", "margin-top", "margin-right", "margin-bottom",
  "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "width", "height", "min-width",
  "min-height", "max-width", "max-height", "border-top-width", "border-right-width", "border-bottom-width",
  "border-left-width", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
]);
const REVISION_VERSION = 1;
const DEFAULT_COMPARISON_LIMITS = Object.freeze({ matchingWork: 5_000, regions: 50, reorderWork: 2_500 });

export function captureArtifactRevision(root, limits = DEFAULT_LIMITS) {
  const activeLimits = { ...DEFAULT_LIMITS, ...limits };
  const elements = [];
  walkElements(root, [], elements, activeLimits);
  const revision = { version: REVISION_VERSION, elements };
  if (serializedBytes(revision) > activeLimits.snapshotBytes) throw new ArtifactRevisionLimitError("snapshotBytes");
  return revision;
}

export function compareArtifactRevisions(previous, current, limits = DEFAULT_COMPARISON_LIMITS) {
  const activeLimits = { ...DEFAULT_COMPARISON_LIMITS, ...limits };
  assertWorkLimit("matchingWork", previous.elements.length + current.elements.length, activeLimits.matchingWork);
  const matches = matchRevisionElements(previous.elements, current.elements);
  assertWorkLimit("reorderWork", matches.length, activeLimits.reorderWork);
  const matchByCurrent = new Map(matches.map((match) => [pathKey(match.current.path), match]));
  const matchedPrevious = new Set(matches.map((match) => pathKey(match.previous.path)));
  const movedPaths = movedCurrentPaths(matches);
  const ambiguousPaths = ambiguousContainerPaths(previous.elements, current.elements, matches);
  const currentChanges = current.elements.flatMap((element) => {
    const currentKey = pathKey(element.path);
    if (ambiguousPaths.has(currentKey)) return [{ kind: "updated", path: element.path }];
    if (insideAnyPath(element.path, ambiguousPaths)) return [];
    const match = matchByCurrent.get(currentKey);
    if (!match) return [{ kind: "added", path: element.path }];
    return classifyMatchedElement(match, movedPaths.has(currentKey));
  });
  const removedChanges = previous.elements.flatMap((element) => {
    if (matchedPrevious.has(pathKey(element.path))) return [];
    const anchorPath = matchedAncestorPath(element.path, matches);
    return ambiguousPaths.has(pathKey(anchorPath)) ? [] : [{ kind: "removed", path: anchorPath }];
  });
  const regions = deduplicateRegions([...currentChanges, ...removedChanges]);
  assertWorkLimit("regions", regions.length, activeLimits.regions);
  return regions;
}

function assertWorkLimit(name, work, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || work > maximum) {
    throw new ArtifactRevisionLimitError(name);
  }
}

export class ArtifactRevisionLimitError extends Error {
  constructor(limit) {
    super(`Artifact revision exceeded the ${limit} limit`);
    this.name = "ArtifactRevisionLimitError";
    this.limit = limit;
  }
}

function walkElements(element, path, elements, limits) {
  if (!(element instanceof Element) || excluded(element)) return;
  if (path.length > limits.depth) throw new ArtifactRevisionLimitError("depth");
  if (elements.length >= limits.elements) throw new ArtifactRevisionLimitError("elements");
  elements.push(captureElement(element, path, limits.text));
  [...element.children].forEach((child, index) => walkElements(child, [...path, index], elements, limits));
}

function captureElement(element, path, textLimit) {
  return {
    path,
    tag: element.tagName.toLowerCase(),
    directText: directText(element, textLimit),
    identity: stableIdentity(element),
    attributes: reviewAttributes(element),
    computedStyles: visibleStyles(element),
  };
}

function stableIdentity(element) {
  return {
    ...(element.id ? { id: element.id } : {}),
    ...(element.dataset.sliceId ? { sliceId: element.dataset.sliceId } : {}),
    ...(element.dataset.criterionId ? { criterionId: element.dataset.criterionId } : {}),
  };
}

function reviewAttributes(element) {
  return Object.fromEntries([...element.attributes]
    .filter(({ name }) => REVIEW_ATTRIBUTES.has(name) || name.startsWith("aria-"))
    .sort(({ name: left }, { name: right }) => left.localeCompare(right))
    .map(({ name, value }) => [name, value]));
}

function visibleStyles(element) {
  const declared = declaredStyleProperties(element);
  const style = getComputedStyle(element);
  const computed = [...declared]
    .filter((property) => VISIBLE_STYLE_PROPERTIES.has(property))
    .sort()
    .map((property) => [property, style.getPropertyValue(property)]);
  const generated = generatedContent(element);
  return Object.fromEntries([...computed, ...generated]);
}

function declaredStyleProperties(element) {
  const properties = new Set([...element.style]);
  for (const styleSheet of element.ownerDocument.styleSheets) {
    collectMatchingDeclarations(styleSheet, element, properties);
  }
  return properties;
}

function collectMatchingDeclarations(container, element, properties) {
  let rules;
  try {
    rules = container.cssRules;
  } catch {
    return;
  }
  for (const rule of rules ?? []) {
    if (rule.cssRules) collectMatchingDeclarations(rule, element, properties);
    if (!rule.selectorText || !selectorMatches(element, rule.selectorText)) continue;
    for (const property of rule.style) properties.add(property);
  }
}

function selectorMatches(element, selectorText) {
  return selectorText.split(",").some((selector) => {
    const baseSelector = selector.replaceAll(/::(before|after)/g, "").trim();
    try {
      return Boolean(baseSelector) && element.matches(baseSelector);
    } catch {
      return false;
    }
  });
}

function generatedContent(element) {
  return ["before", "after"].flatMap((position) => {
    const content = getComputedStyle(element, `::${position}`).content;
    return new Set(["", "none", "normal"]).has(content) ? [] : [[`${position}-content`, content]];
  });
}

function excluded(element) {
  return element.matches(EXCLUDED_ELEMENTS) || Boolean(element.closest("[data-review-artifact-ui]"));
}

function directText(element, maximum) {
  const text = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
  return text.slice(0, maximum);
}

function ambiguousContainerPaths(previousElements, currentElements, matches) {
  const previousIdentities = identityIndex(previousElements);
  const currentIdentities = identityIndex(currentElements);
  const paths = new Set();
  for (const [identity, currentCandidates] of currentIdentities) {
    const previousCandidates = previousIdentities.get(identity) ?? [];
    if (currentCandidates.length === 1 && previousCandidates.length === 1) continue;
    if (currentCandidates.length === 0 || previousCandidates.length === 0) continue;
    for (const candidate of currentCandidates) {
      paths.add(pathKey(matchedAncestorPathForCurrent(candidate.path, matches)));
    }
  }
  return paths;
}

function matchedAncestorPathForCurrent(currentPath, matches) {
  const matchedPaths = new Set(matches.map(({ current }) => pathKey(current.path)));
  for (let length = currentPath.length - 1; length >= 0; length -= 1) {
    const candidate = currentPath.slice(0, length);
    if (matchedPaths.has(pathKey(candidate))) return candidate;
  }
  return [];
}

function insideAnyPath(path, ancestorKeys) {
  for (let length = path.length - 1; length >= 0; length -= 1) {
    if (ancestorKeys.has(pathKey(path.slice(0, length)))) return true;
  }
  return false;
}

function matchRevisionElements(previousElements, currentElements) {
  const matches = [];
  const usedPrevious = new Set();
  const usedCurrent = new Set();
  matchUniqueIdentities(previousElements, currentElements, matches, usedPrevious, usedCurrent);
  matchSameContentAtPath(previousElements, currentElements, matches, usedPrevious, usedCurrent);
  matchUniqueStructuralAnchors(previousElements, currentElements, matches, usedPrevious, usedCurrent);
  matchRemainingPaths(previousElements, currentElements, matches, usedPrevious, usedCurrent);
  return matches;
}

function matchSameContentAtPath(previousElements, currentElements, matches, usedPrevious, usedCurrent) {
  const previousByPath = elementMap(previousElements);
  for (const current of currentElements) {
    const previous = previousByPath.get(pathKey(current.path));
    if (!eligiblePathMatch(previous, current, usedPrevious, usedCurrent) || !sameContent(previous, current)) continue;
    recordMatch(previous, current, matches, usedPrevious, usedCurrent);
  }
}

function matchUniqueStructuralAnchors(previousElements, currentElements, matches, usedPrevious, usedCurrent) {
  for (const current of currentElements) {
    if (usedCurrent.has(pathKey(current.path)) || identityKey(current)) continue;
    const parentMatch = matches.find(({ current: matched }) => pathKey(matched.path) === parentPathKey(current));
    if (!parentMatch) continue;
    const previousCandidates = unmatchedSiblings(previousElements, parentMatch.previous.path, current, usedPrevious);
    const currentCandidates = unmatchedSiblings(currentElements, parentMatch.current.path, current, usedCurrent);
    if (previousCandidates.length !== 1 || currentCandidates.length !== 1) continue;
    recordMatch(previousCandidates[0], current, matches, usedPrevious, usedCurrent);
  }
}

function unmatchedSiblings(elements, parentPath, reference, usedPaths) {
  const signature = structuralKey(reference);
  return elements.filter((element) => parentPathKey(element) === pathKey(parentPath)
    && !usedPaths.has(pathKey(element.path))
    && !identityKey(element)
    && structuralKey(element) === signature);
}

function matchRemainingPaths(previousElements, currentElements, matches, usedPrevious, usedCurrent) {
  const previousByPath = elementMap(previousElements);
  for (const current of currentElements) {
    const previous = previousByPath.get(pathKey(current.path));
    if (!eligiblePathMatch(previous, current, usedPrevious, usedCurrent)) continue;
    recordMatch(previous, current, matches, usedPrevious, usedCurrent);
  }
}

function eligiblePathMatch(previous, current, usedPrevious, usedCurrent) {
  if (!previous || usedCurrent.has(pathKey(current.path)) || usedPrevious.has(pathKey(previous.path))) return false;
  return !identityKey(previous) && !identityKey(current) && previous.tag === current.tag;
}

function structuralKey(element) {
  return JSON.stringify([element.tag, element.directText, element.attributes ?? {}, element.computedStyles ?? {}]);
}

function parentPathKey(element) {
  return pathKey(element.path.slice(0, -1));
}

function matchUniqueIdentities(previousElements, currentElements, matches, usedPrevious, usedCurrent) {
  const previousIdentities = identityIndex(previousElements);
  const currentIdentities = identityIndex(currentElements);
  for (const [identity, previousCandidates] of previousIdentities) {
    const currentCandidates = currentIdentities.get(identity) ?? [];
    if (previousCandidates.length !== 1 || currentCandidates.length !== 1) continue;
    recordMatch(previousCandidates[0], currentCandidates[0], matches, usedPrevious, usedCurrent);
  }
}

function identityIndex(elements) {
  const index = new Map();
  for (const element of elements) {
    const identity = identityKey(element);
    if (!identity) continue;
    index.set(identity, [...index.get(identity) ?? [], element]);
  }
  return index;
}

function identityKey(element) {
  if (element.identity?.id) return `id:${element.identity.id}`;
  if (element.identity?.sliceId) return `slice:${element.identity.sliceId}`;
  if (element.identity?.criterionId) return `criterion:${element.identity.criterionId}`;
  return "";
}

function recordMatch(previous, current, matches, usedPrevious, usedCurrent) {
  const previousKey = pathKey(previous.path);
  const currentKey = pathKey(current.path);
  if (usedPrevious.has(previousKey) || usedCurrent.has(currentKey)) return;
  matches.push({ previous, current });
  usedPrevious.add(previousKey);
  usedCurrent.add(currentKey);
}

function classifyMatchedElement(match, moved) {
  const updated = !sameContent(match.previous, match.current);
  if (updated && moved) return [{ kind: "updated-moved", path: match.current.path }];
  if (updated) return [{ kind: "updated", path: match.current.path }];
  return moved ? [{ kind: "moved", path: match.current.path }] : [];
}

function sameContent(previous, current) {
  return previous.directText === current.directText
    && JSON.stringify(previous.attributes ?? {}) === JSON.stringify(current.attributes ?? {})
    && JSON.stringify(previous.computedStyles ?? {}) === JSON.stringify(current.computedStyles ?? {});
}

function movedCurrentPaths(matches) {
  const parentMatches = new Map(matches.map(({ previous, current }) => [
    pathKey(previous.path), pathKey(current.path),
  ]));
  const groups = new Map();
  for (const match of matches) {
    if (match.previous.path.length === 0 || match.current.path.length === 0) continue;
    const previousParent = pathKey(match.previous.path.slice(0, -1));
    const currentParent = pathKey(match.current.path.slice(0, -1));
    if (parentMatches.get(previousParent) !== currentParent) continue;
    const groupKey = `${previousParent}>${currentParent}`;
    groups.set(groupKey, [...groups.get(groupKey) ?? [], match]);
  }
  return new Set([...groups.values()].flatMap(movedPathsInGroup));
}

function movedPathsInGroup(matches) {
  const previousOrder = [...matches].sort((left, right) => lastIndex(left.previous) - lastIndex(right.previous));
  const currentOrder = [...matches].sort((left, right) => lastIndex(left.current) - lastIndex(right.current));
  const previousRanks = new Map(previousOrder.map((match, rank) => [pathKey(match.current.path), rank]));
  return currentOrder.flatMap((match, rank) => previousRanks.get(pathKey(match.current.path)) === rank
    ? []
    : [pathKey(match.current.path)]);
}

function lastIndex(element) {
  return element.path.at(-1) ?? 0;
}

function matchedAncestorPath(previousPath, matches) {
  const currentPathByPrevious = new Map(matches.map(({ previous, current }) => [
    pathKey(previous.path), current.path,
  ]));
  for (let length = previousPath.length - 1; length >= 0; length -= 1) {
    const currentPath = currentPathByPrevious.get(pathKey(previousPath.slice(0, length)));
    if (currentPath) return currentPath;
  }
  return [];
}

function deduplicateRegions(regions) {
  return [...new Map(regions.map((region) => [`${region.kind}:${pathKey(region.path)}`, region])).values()];
}

function elementMap(elements) {
  return new Map(elements.map((element) => [pathKey(element.path), element]));
}

function pathKey(path) {
  return path.join(".");
}

function serializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
