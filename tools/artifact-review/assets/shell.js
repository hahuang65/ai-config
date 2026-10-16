'use strict';
const $ = selector => document.querySelector(selector);
const frame = $('#artifact');
const STORAGE = 'artifact-review-draft';
const MAX_ANNOTATIONS = 16;
const MAX_TEXT = 2000;
const RELOAD_MS = 700;
const EVENT_WAIT_MS = 30000;
let capability = location.hash.slice(1);
if (capability) sessionStorage.setItem('artifact-review-capability', capability);
else capability = sessionStorage.getItem('artifact-review-capability') || '';
history.replaceState(null, '', '/');
let cursor = 0;
let status = 'open';
let approvedRevision = null;
let ready = false;
let busy = false;
let queued = [];
let target = null;
let pending = null;
let listening = false;
let eventsConnected = true;
const findings = new FindingControls(frame, (action, id) => submit(action, id), persist);
const publication = new PublicationControls(frame, request);
const annotationPopover = new AnnotationPopover(frame);

function notice(message) { $('#notice').textContent = message; }
function byteLength(text) { return new TextEncoder().encode(text).length; }
function excerpt(text, limit) {
  return new TextDecoder().decode(new TextEncoder().encode(text).slice(0, limit - 3));
}

async function request(route, body, timeout = 4000) {
  const response = await fetch(route, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
    cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || 'Review request failed.');
    error.rejected = true;
    throw error;
  }
  return payload;
}

function persist() {
  sessionStorage.setItem(STORAGE, JSON.stringify({
    queued, target, pending, findingComments: findings.comments,
    message: $('#message').value, comment: $('#annotation-comment').value,
  }));
}

function restore() {
  const saved = JSON.parse(sessionStorage.getItem(STORAGE) || '{}');
  queued = saved.queued || [];
  target = saved.target || null;
  pending = saved.pending || null;
  findings.comments = saved.findingComments || {};
  $('#message').value = saved.message || '';
  $('#annotation-comment').value = saved.comment || '';
  showTarget();
  showQueue();
}

function controls() {
  const closed = status !== 'open';
  for (const id of ['approve', 'send', 'decline']) {
    $(`#${id}`).disabled = closed || busy || !!pending || !frame.dataset.revision;
  }
  $('#approve').disabled ||= !ready;
  for (const id of ['message', 'annotation-comment', 'add-annotation', 'cancel-annotation']) {
    $(`#${id}`).disabled = closed || busy || !!pending;
  }
  $('#retry').hidden = !pending || busy;
  const unapproved = status === 'approved' && frame.dataset.revision !== approvedRevision;
  document.body.dataset.status = unapproved ? 'needs-review' : status;
  if (status === 'approved') notice(unapproved
    ? 'Displayed version is not approved. Open another review.'
    : 'Review approved. Later file changes need another review.');
  const findingNotice = findings.controls(closed || busy || !!pending, ready, status);
  if (findingNotice) notice(findingNotice);
  annotationPopover.update(target);
  publication.controls();
}

function showTarget(anchor) {
  $('#annotation-target').textContent = target ? `${target.kind === 'selection' ? 'Selected text' : 'Element'}: ${target.text}` : 'Annotation';
  annotationPopover.update(target, anchor);
}

function chooseTarget(next, anchor) {
  if (busy || pending || status !== 'open') return;
  if (target && $('#annotation-comment').value.trim()) {
    notice('Add or cancel the current annotation first.');
    return;
  }
  target = next;
  showTarget(anchor);
  persist();
  $('#annotation-comment').focus({ preventScroll: true });
}

function selector(element) {
  if (element.id) return excerpt(`#${CSS.escape(element.id)}`, 1000);
  const parts = [];
  while (element?.tagName && parts.length < 8) {
    if (!element.parentElement) { parts.unshift(element.tagName.toLowerCase()); break; }
    const siblings = [...element.parentElement.children].filter(node => node.tagName === element.tagName);
    parts.unshift(`${element.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(element) + 1})`);
    element = element.parentElement;
  }
  return parts.join(' > ');
}

function attachAnnotations(revision) {
  const doc = frame.contentDocument;
  annotationPopover.attach();
  doc.addEventListener('click', event => {
    if (event.target.closest('[data-finding-controls]')) return;
    event.preventDefault();
    if (doc.getSelection()?.toString().trim()) return;
    const element = event.target.closest('body *');
    if (!element) return;
    chooseTarget({ kind: 'element', target: selector(element), text: excerpt(element.textContent.trim(), MAX_TEXT), revision }, element);
  }, true);
  doc.addEventListener('submit', event => event.preventDefault(), true);
  doc.addEventListener('mouseup', event => {
    if (event.target.closest?.('[data-finding-controls]')) return;
    const selection = doc.getSelection();
    if (!selection?.toString().trim()) return;
    const element = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
    chooseTarget({ kind: 'selection', target: selector(element), text: excerpt(selection.toString(), MAX_TEXT), revision }, selection.getRangeAt(0).cloneRange());
  });
}

function annotationDraft() {
  const comment = $('#annotation-comment').value.trim();
  if (!target || !comment) return null;
  if (byteLength(comment) > 4000) throw new Error('Annotation limit is 4000 UTF-8 bytes.');
  return { ...target, comment };
}

function addAnnotation() {
  try {
    const annotation = annotationDraft();
    if (!annotation) throw new Error('Write an annotation first.');
    if (queued.length >= MAX_ANNOTATIONS) throw new Error('Send these annotations before adding more.');
    queued = [...queued, annotation];
    target = null;
    $('#annotation-comment').value = '';
    persist();
    showTarget();
    showQueue();
    notice('Annotation added. Send feedback or choose a review outcome to submit it.');
  } catch (error) { notice(error.message); }
}

function showQueue() {
  $('#queued').replaceChildren();
  queued.forEach((annotation, index) => {
    const row = document.createElement('div');
    row.className = 'queued';
    const text = document.createElement('span');
    text.textContent = `${annotation.text}: ${annotation.comment}`;
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      if (busy || pending) return;
      queued = queued.filter((_, position) => position !== index);
      persist();
      showQueue();
    });
    row.append(text, remove);
    $('#queued').append(row);
  });
}

function renderEvent(event) {
  const row = document.createElement('article');
  row.className = `message ${event.action === 'reply' ? 'agent' : 'user'}`;
  const title = document.createElement('strong');
  const labels = { feedback: 'Feedback', approve: 'Approved', decline: 'Declined', reply: 'Agent', reopen: 'New review' };
  title.textContent = event.finding
    ? `${event.finding} · ${event.action === 'accept' ? 'Accepted — repair authorized' : 'Rejected — no repair authorized'}`
    : labels[event.action] || 'Review';
  const message = document.createElement('p');
  message.textContent = event.message;
  row.append(title, message);
  for (const annotation of event.annotations) {
    const block = document.createElement('p');
    block.className = 'annotation';
    const label = document.createElement('small');
    label.textContent = `${annotation.kind === 'selection' ? 'Selected text' : 'Element'}: ${annotation.text}`;
    const comment = document.createElement('span');
    comment.textContent = annotation.comment;
    block.append(label, comment);
    row.append(block);
  }
  $('#messages').append(row);
}

async function refreshEvents(wait = false) {
  let more = true;
  while (more) {
    const page = await request(`/events?cursor=${cursor}${wait ? `&wait_ms=${EVENT_WAIT_MS}` : ''}`, undefined, wait ? EVENT_WAIT_MS + 4000 : 4000);
    eventsConnected = true;
    wait = false;
    if (page.cursor < cursor) return;
    // A submission and a refresh can finish together; each event is rendered once.
    for (const event of page.events) {
      if (event.cursor <= cursor) continue;
      renderEvent(event);
      cursor = event.cursor;
    }
    status = page.status;
    approvedRevision = page.approved_revision;
    findings.update(page.finding_review);
    publication.update(page.finding_review);
    more = page.more;
  }
  if (status === 'declined') notice('Review ended without approval.');
  controls();
}

async function refreshSnapshot() {
  if (status !== 'open' && frame.dataset.revision) return;
  const current = await request('/revision');
  if (current.revision === frame.dataset.revision) { ready = true; return; }
  const snapshot = await request('/snapshot');
  // The previous revision no longer describes the iframe once replacement begins.
  frame.dataset.revision = '';
  ready = false;
  controls();
  const scroll = frame.contentWindow?.scrollY || 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { frame.onload = null; reject(new Error('Document load timed out.')); }, 4000);
    frame.onload = () => {
      clearTimeout(timer);
      const images = [...frame.contentDocument.querySelectorAll('img[src]')];
      if (images.some(image => !image.complete || image.naturalWidth === 0)) {
        reject(new Error('A render could not be displayed.'));
        return;
      }
      attachAnnotations(snapshot.revision);
      frame.dataset.revision = snapshot.revision;
      frame.contentWindow.scrollTo(0, scroll);
      ready = true;
      resolve();
    };
    frame.srcdoc = snapshot.html;
  });
}

async function listen() {
  while (status === 'open') {
    try { await refreshEvents(true); }
    catch {
      eventsConnected = false;
      $('#connection').textContent = 'Disconnected — retrying';
      await new Promise(resolve => setTimeout(resolve, RELOAD_MS));
    }
  }
  listening = false;
}

async function refresh() {
  try {
    if (!listening) {
      await refreshEvents();
      if (status === 'open') { listening = true; void listen(); }
    }
    await refreshSnapshot();
    $('#connection').textContent = !eventsConnected ? 'Disconnected — retrying' : status === 'open' ? 'Connected' : 'Review closed';
  } catch {
    ready = false;
    $('#connection').textContent = 'Disconnected — retrying';
  }
  controls();
  setTimeout(refresh, RELOAD_MS);
}

function submissionMessage(finding) {
  const general = $('#message').value.trim();
  const comment = finding ? findings.comment(finding).trim() : '';
  if (byteLength(comment) > 4000) throw new Error('Finding comment is too long. Shorten it before deciding.');
  if (!comment) return general;
  return general ? `Finding ${finding} comment:\n${comment}\n\nGeneral feedback:\n${general}` : comment;
}

async function submit(action, finding) {
  if (busy || pending || status !== 'open') return;
  try {
    const draft = annotationDraft();
    const annotations = draft ? [...queued, draft] : queued;
    const message = submissionMessage(finding);
    if (annotations.length > MAX_ANNOTATIONS || byteLength(message) > 8000) throw new Error('Feedback exceeds the input limit.');
    if (action === 'feedback' && !message && !annotations.length) throw new Error('Write feedback before sending.');
    pending = { id: crypto.randomUUID(), action, revision: frame.dataset.revision, message, annotations,
      ...(finding ? { finding } : {}) };
    persist();
  } catch (error) { pending = null; notice(error.message); return; }
  await sendPending();
}

async function sendPending() {
  if (!pending || busy) return;
  busy = true;
  controls();
  try {
    await request('/submit', pending);
    if (pending.finding) findings.saved(pending.finding);
    pending = null;
    queued = [];
    target = null;
    $('#message').value = '';
    $('#annotation-comment').value = '';
    persist();
    showTarget();
    showQueue();
    notice('Feedback saved.');
    await refreshEvents();
  } catch (error) {
    if (error.rejected) { pending = null; persist(); }
    notice(error.rejected ? error.message : 'Delivery is not confirmed. Retry submission; your feedback is kept.');
  } finally { busy = false; controls(); }
}

$('#add-annotation').addEventListener('click', addAnnotation);
$('#cancel-annotation').addEventListener('click', () => {
  target = null;
  $('#annotation-comment').value = '';
  persist();
  showTarget();
});
for (const id of ['message', 'annotation-comment']) $(`#${id}`).addEventListener('input', persist);
$('#send').addEventListener('click', () => submit('feedback'));
$('#approve').addEventListener('click', () => submit('approve'));
$('#decline').addEventListener('click', () => submit('decline'));
$('#retry').addEventListener('click', sendPending);
try { restore(); refresh(); } catch { notice('Private browser storage is required for reliable submission retries.'); }
