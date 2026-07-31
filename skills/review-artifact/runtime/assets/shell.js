(() => {
  "use strict";

  const DEFAULT_THEME = "catppuccin-mocha";
  const session = JSON.parse(document.getElementById("review-session").textContent);
  const artifact = document.getElementById("artifact");
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
  let annotationMode = true;
  let queued = readQueue();
  let pendingAction = "feedback";
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
      return JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    } catch {
      return [];
    }
  }

  function persistQueue() {
    if (queued.length) sessionStorage.setItem(storageKey, JSON.stringify(queued));
    else sessionStorage.removeItem(storageKey);
  }

  function renderQueue() {
    queuedContainer.replaceChildren();
    for (const [index, prompt] of queued.entries()) {
      const pill = document.createElement("div");
      pill.className = "queued-prompt";
      const text = document.createElement("span");
      const prefix = prompt.tag && prompt.tag !== "message" ? `[${prompt.tag}] ` : "";
      text.textContent = prefix + prompt.prompt;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove queued feedback");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        queued = queued.filter((_, promptIndex) => promptIndex !== index);
        persistQueue();
        renderQueue();
      });
      pill.append(text, remove);
      queuedContainer.append(pill);
    }
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
      queued.push({ prompt: text, selector: "", tag: "message", text: "Freeform message" });
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
    persistQueue();
    renderQueue();
    for (const prompt of submitted) {
      addMessage({ role: "user", text: prompt.prompt, prompt });
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

  window.addEventListener("message", (event) => {
    if (event.source !== artifact.contentWindow) return;
    if (event.data?.type === "review:queue") {
      queued.push(event.data.prompt);
      persistQueue();
      renderQueue();
    }
    if (event.data?.type === "review:snapshot") submit(event.data.snapshot || "");
    if (event.data?.type === "review:layout") reportLayout(event.data.layoutWarnings || []);
    if (event.data?.type === "review:locate-result") {
      if (activeLocateBadge?.isConnected) activeLocateBadge.classList.toggle("missing", !event.data.ok);
    }
  });

  async function reportLayout(layoutWarnings) {
    await fetch(`/api/sessions/${session.key}/layout-warnings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layoutWarnings }),
    });
    if (layoutWarnings.length === 0) {
      layoutGate.hidden = true;
      return;
    }
    layoutGateTitle.textContent = "Severe layout failure";
    layoutGateCopy.textContent = "The agent has been notified before review begins.";
  }

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
    if (update.type === "reload") reloadArtifact();
  };

  function setPresence(state) {
    document.body.dataset.presence = state;
    presence.textContent = {
      listening: "Agent listening",
      working: "Agent working",
      waiting: "Agent not listening",
    }[state] || "Agent not listening";
  }

  function reloadArtifact() {
    let position = { x: 0, y: 0 };
    try {
      position = { x: artifact.contentWindow.scrollX, y: artifact.contentWindow.scrollY };
    } catch {
      // The sandbox may deny access for an artifact that changes its own origin.
    }
    artifact.addEventListener("load", () => {
      try {
        artifact.contentWindow.scrollTo(position.x, position.y);
      } catch {
        // Reload still succeeds when scroll restoration is unavailable.
      }
      artifact.contentWindow?.postMessage({ type: "review:set-mode", enabled: annotationMode }, "*");
    }, { once: true });
    const source = new URL(artifact.src);
    source.searchParams.set("reload", String(Date.now()));
    artifact.src = source.toString();
  }

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
      event.preventDefault();
      modeButton.click();
    }
  });

  setTimeout(() => {
    if (layoutGateTitle.textContent === "Checking layout") layoutGate.hidden = true;
  }, 4_000);

  for (const chat of session.initialChat || []) addMessage(chat);
  renderQueue();
  setWorking(false);
})();
