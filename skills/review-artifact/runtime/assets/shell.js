import { compareArtifactRevisions } from "./artifact-revision.js";
import { createChangeBar } from "./change-bar.js";
import { createArtifactChangePresenter } from "./change-presenter.js";
import { createBrowserReloadController } from "./change-session.js";
import {
  appendPrompt,
  validateChatEntries,
  validateFrameMessage,
  validateStoredQueue,
} from "./message-validation.js";

(() => {
  "use strict";

  const DEFAULT_THEME = "catppuccin-mocha";
  const session = JSON.parse(document.getElementById("review-session").textContent);
  const artifact = document.getElementById("artifact");
  const changeBar = document.querySelector("[data-review-change-bar]");
  const changeCount = document.querySelector("[data-review-change-count]");
  const dismissChangesButton = document.querySelector('[data-review-change-action="dismiss"]');
  const nextChangeButton = document.querySelector('[data-review-change-action="next"]');
  const previousChangeButton = document.querySelector('[data-review-change-action="previous"]');
  const modeButton = document.getElementById("mode");
  const themeSelect = document.getElementById("theme");
  const presence = document.getElementById("presence");
  const messageInput = document.getElementById("message");
  const queuedContainer = document.getElementById("queued");
  const messages = document.getElementById("messages");
  const sendButton = document.getElementById("send");
  const approveButton = document.getElementById("approve");
  const endButton = document.getElementById("end");
  const layoutGate = document.getElementById("layout-gate");
  const layoutGateTitle = document.getElementById("layout-gate-title");
  const layoutGateCopy = document.getElementById("layout-gate-copy");
  const showAnywayButton = document.getElementById("show-anyway");
  const storageKey = `review-artifact:${session.key}:queued`;
  const themeStorageKey = "review-artifact:theme";
  const supportedThemes = new Set([...themeSelect.options].map((option) => option.value));
  let annotationMode = session.mode !== "explore";
  let queued = readQueue();
  let pendingAction = "feedback";
  let queueLimitReported = false;
  let artifactScroll = { x: 0, y: 0 };
  const changeBarView = createChangeBar({ bar: changeBar, count: changeCount });
  const changePresenter = createArtifactChangePresenter({ artifact, changeBar: changeBarView });
  const reloadController = createBrowserReloadController({
    compare: compareArtifactRevisions,
    navigate: reloadArtifact,
    present: changePresenter.present,
  });
  applyTheme(readTheme(), { persist: false });

  function readTheme() {
    try {
      const storedTheme = localStorage.getItem(themeStorageKey);
      return supportedThemes.has(storedTheme) ? storedTheme : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  function applyTheme(theme, { persist = true } = {}) {
    const selectedTheme = supportedThemes.has(theme) ? theme : DEFAULT_THEME;
    document.documentElement.dataset.theme = selectedTheme;
    themeSelect.value = selectedTheme;
    if (!persist) return;
    try {
      localStorage.setItem(themeStorageKey, selectedTheme);
    } catch {
      // Theme persistence is optional when browser storage is unavailable.
    }
  }

  function readQueue() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      return validateStoredQueue(stored);
    } catch {
      return [];
    }
  }

  function persistQueue() {
    try {
      if (queued.length) sessionStorage.setItem(storageKey, JSON.stringify(queued));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // The in-memory queue remains usable when browser storage is unavailable.
    }
  }

  function renderQueue() {
    queuedContainer.replaceChildren();
    for (const [index, prompt] of queued.entries()) {
      const pill = document.createElement("div");
      pill.className = "queued-prompt";
      const text = document.createElement("span");
      const prefix = prompt.tag && prompt.tag !== "message" ? `[${prompt.tag}] ` : "";
      text.textContent = prefix + (prompt.displayText || prompt.prompt);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove queued feedback");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        queued = queued.filter((_, promptIndex) => promptIndex !== index);
        queueLimitReported = false;
        persistQueue();
        renderQueue();
      });
      pill.append(text, remove);
      queuedContainer.append(pill);
    }
  }

  function queuePrompt(prompt) {
    const nextQueue = appendPrompt(queued, prompt);
    if (!nextQueue) {
      if (!queueLimitReported) {
        addMessage({ role: "agent", text: "Feedback queue is full. Send or remove feedback before adding more." });
        queueLimitReported = true;
      }
      return false;
    }
    queued = nextQueue;
    persistQueue();
    renderQueue();
    return true;
  }

  function addMessage(entry) {
    const role = entry?.role ?? "user";
    const text = entry?.text ?? "";
    if (!text) return;
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    const label = document.createElement("strong");
    label.textContent = role === "agent" ? "Agent" : "You";
    bubble.append(label);
    const annotation = entry?.prompt;
    if (role === "user" && annotation && annotation.tag && annotation.tag !== "message") {
      bubble.classList.add("annotation");
      bubble.append(annotationBadge(annotation));
    }
    const body = document.createElement("div");
    body.textContent = text;
    bubble.append(body);
    messages.append(bubble);
    bubble.scrollIntoView({ block: "nearest" });
  }

  function annotationBadge(annotation) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "annotation-badge";
    badge.setAttribute("aria-label", "Highlight the annotated element in the artifact");
    badge.title = annotation.selector ? `Annotated element: ${annotation.selector}` : "Annotated element";
    const pin = document.createElement("span");
    pin.className = "pin";
    pin.textContent = "◎";
    const target = document.createElement("span");
    target.className = "target";
    target.textContent = annotationLabel(annotation);
    badge.append(pin, target);
    badge.addEventListener("mouseenter", () => locateAnnotation(annotation, badge, { scroll: false }));
    badge.addEventListener("mouseleave", () => locateClear());
    badge.addEventListener("click", () => locateAnnotation(annotation, badge, { scroll: true }));
    return badge;
  }

  function annotationLabel(annotation) {
    const snippet = (annotation.target?.text || annotation.text || "").replace(/\s+/g, " ").trim();
    const shortened = snippet.length > 60 ? `${snippet.slice(0, 60)}…` : snippet;
    const quoted = shortened ? ` “${shortened}”` : "";
    if (annotation.tag === "text") return `text${quoted}`;
    return `${annotation.tag}${quoted}`;
  }

  function annotationTarget(annotation) {
    return annotation.target?.selector || annotation.selector || "";
  }

  let activeLocateBadge = null;
  function locateAnnotation(annotation, badge, { scroll }) {
    activeLocateBadge = badge;
    artifact.contentWindow?.postMessage(
      { type: "review:locate", selector: annotationTarget(annotation), scroll },
      "*",
    );
  }

  function locateClear() {
    activeLocateBadge = null;
    artifact.contentWindow?.postMessage({ type: "review:locate-clear" }, "*");
  }

  function requestSnapshot(action) {
    pendingAction = action;
    artifact.contentWindow?.postMessage({ type: "review:request-snapshot" }, "*");
  }

  async function submit(snapshot) {
    const text = messageInput.value.trim();
    if (text) {
      const accepted = queuePrompt({ prompt: text, selector: "", tag: "message", text: "Freeform message" });
      if (!accepted) {
        messageInput.focus();
        return;
      }
      messageInput.value = "";
    }
    if (pendingAction === "feedback" && queued.length === 0) {
      messageInput.focus();
      return;
    }
    const submitted = [...queued];
    setWorking(true);
    const response = await fetch(`/api/sessions/${session.key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompts: submitted, domSnapshot: snapshot, action: pendingAction }),
    });
    if (!response.ok) {
      setWorking(false);
      addMessage({ role: "agent", text: "Feedback could not be sent. Please retry." });
      return;
    }
    queued = [];
    queueLimitReported = false;
    persistQueue();
    renderQueue();
    for (const prompt of submitted) {
      addMessage({ role: "user", text: prompt.displayText || prompt.prompt, prompt });
    }
    if (pendingAction !== "feedback") markEnded(pendingAction);
  }

  function setWorking(working) {
    sendButton.disabled = working;
    approveButton.disabled = working;
    endButton.disabled = working;
    setPresence(working ? "working" : "listening");
  }

  function markEnded(action) {
    document.body.dataset.session = action === "approve" ? "approved" : "ended";
    setWorking(true);
  }

  function synchronizeArtifact() {
    artifact.contentWindow?.postMessage({ type: "review:get-ready" }, "*");
    artifact.contentWindow?.postMessage({ type: "review:set-mode", enabled: annotationMode }, "*");
  }

  artifact.addEventListener("load", synchronizeArtifact);
  window.addEventListener("message", (event) => {
    if (event.source !== artifact.contentWindow) return;
    const message = validateFrameMessage(event.data);
    if (!message) return;
    if (message.type === "review:ready") {
      if (message.title) document.title = message.title;
      artifact.contentWindow?.postMessage({ type: "review:set-mode", enabled: annotationMode }, "*");
    }
    if (message.type === "review:queue") queuePrompt(message.prompt);
    if (message.type === "review:submit" && queuePrompt(message.prompt)) requestSnapshot("feedback");
    if (message.type === "review:snapshot") submit(message.snapshot);
    if (message.type === "review:artifact-revision") {
      reloadController.accept({
        type: "frame-settled",
        generation: message.generation,
        revision: message.revision,
      });
      artifact.dataset.reviewRevisionReady = "true";
    }
    if (message.type === "review:artifact-revision-failed") {
      reloadController.accept({
        type: "frame-failed",
        generation: message.generation,
        status: message.status,
      });
      artifact.dataset.reviewRevisionReady = "true";
    }
    if (message.type === "review:change-presentation-failed") {
      changePresenter.presentationFailed(message);
    }
    if (message.type === "review:layout") reportLayout(message.layoutWarnings);
    if (message.type === "review:scroll") artifactScroll = { x: message.x, y: message.y };
    if (message.type === "review:locate-result" && activeLocateBadge?.isConnected) {
      activeLocateBadge.classList.toggle("missing", !message.ok);
    }
  });
  synchronizeArtifact();

  async function reportLayout(layoutWarnings) {
    const hasLayoutFailure = layoutWarnings.length > 0;
    layoutGate.hidden = !hasLayoutFailure;
    if (hasLayoutFailure) {
      layoutGateTitle.textContent = "Severe layout failure";
      layoutGateCopy.textContent = "The agent has been notified before review begins.";
    }
    await fetch(`/api/sessions/${session.key}/layout-warnings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layoutWarnings }),
    });
  }

  nextChangeButton.addEventListener("click", () => changePresenter.activate("next"));
  previousChangeButton.addEventListener("click", () => changePresenter.activate("previous"));
  dismissChangesButton.addEventListener("click", changePresenter.dismiss);
  modeButton.addEventListener("click", () => {
    annotationMode = !annotationMode;
    modeButton.setAttribute("aria-pressed", String(annotationMode));
    modeButton.textContent = annotationMode ? "Annotate" : "Explore";
    artifact.contentWindow?.postMessage({ type: "review:set-mode", enabled: annotationMode }, "*");
  });
  themeSelect.addEventListener("change", () => applyTheme(themeSelect.value));
  sendButton.addEventListener("click", () => requestSnapshot("feedback"));
  showAnywayButton.addEventListener("click", () => { layoutGate.hidden = true; });
  approveButton.addEventListener("click", () => requestSnapshot("approve"));
  endButton.addEventListener("click", () => requestSnapshot("end"));
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      requestSnapshot("feedback");
    }
  });
  const eventStream = new EventSource(`/api/sessions/${session.key}/events`);
  eventStream.onmessage = (event) => {
    const update = JSON.parse(event.data);
    if (update.type === "agent-reply") {
      addMessage({ role: "agent", text: update.text });
      setWorking(false);
    }
    if (update.type === "presence") {
      setPresence(update.state);
    }
    if (update.type === "reload") reloadController.accept({ type: "reload-requested" });
  };

  function setPresence(state) {
    document.body.dataset.presence = state;
    presence.textContent = {
      listening: "Agent listening",
      working: "Agent working",
      waiting: "Agent not listening",
    }[state] || "Agent not listening";
  }

  function reloadArtifact(generation) {
    const position = artifactScroll;
    delete artifact.dataset.reviewRevisionReady;
    artifact.addEventListener("load", () => {
      artifact.contentWindow?.postMessage({ type: "review:restore-scroll", ...position }, "*");
      artifact.contentWindow?.postMessage({ type: "review:set-mode", enabled: annotationMode }, "*");
    }, { once: true });
    const source = new URL(artifact.src);
    source.searchParams.set("reload", String(Date.now()));
    source.searchParams.set("generation", String(generation));
    artifact.src = source.toString();
  }

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
      event.preventDefault();
      modeButton.click();
    }
  });


  for (const chat of validateChatEntries(session.initialChat)) addMessage(chat);
  renderQueue();
  setWorking(false);
})();
