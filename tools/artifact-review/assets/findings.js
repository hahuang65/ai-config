'use strict';

class FindingControls {
  constructor(frame, decide, persist) {
    this.frame = frame;
    this.decide = decide;
    this.persist = persist;
    this.comments = {};
    this.review = null;
    this.document = null;
    this.rows = new Map();
  }

  update(review) {
    this.review = review || null;
    if (this.review?.publication_only && this.rows.size) {
      for (const { row } of this.rows.values()) row.remove();
      this.rows.clear(); this.document = null;
    }
    const title = this.review ? 'Change review' : 'Review artifact';
    document.title = title;
    document.querySelector('.toolbar strong').textContent = title;
    document.querySelector('#approve').hidden = !!this.review;
    document.querySelector('#decline').textContent = this.review ? 'End review' : 'Decline';
    document.querySelector('#finding-policy').hidden = !this.review || this.review.publication_only;
  }

  mount() {
    const doc = this.frame.contentDocument;
    if (!this.review || !this.frame.dataset.revision || doc === this.document) return;
    this.document = doc;
    this.rows.clear();
    const style = doc.createElement('style');
    style.textContent = FINDING_CONTROL_STYLE;
    doc.head.append(style);
    for (const item of this.review.items) {
      const matches = doc.querySelectorAll(`[id="${item.id}"]`);
      if (matches.length !== 1 || matches[0].tagName !== 'ARTICLE') continue;
      this.renderItem(doc, matches[0], item);
    }
  }

  key(id) { return `${this.review.report_digest}:${id}`; }
  comment(id) { return this.comments[this.key(id)] || ''; }

  saved(id) {
    delete this.comments[this.key(id)];
    const comment = this.rows.get(id)?.row.querySelector('[data-finding-comment]');
    if (comment) comment.value = '';
  }

  renderComment(doc, row, item) {
    const label = doc.createElement('label');
    label.append(doc.createTextNode(`Comment on ${item.id} (optional)`));
    const comment = doc.createElement('textarea');
    comment.dataset.findingComment = item.id;
    comment.rows = 3;
    comment.maxLength = 4000;
    comment.value = this.comment(item.id);
    comment.addEventListener('input', () => {
      this.comments[this.key(item.id)] = comment.value;
      this.persist();
    });
    label.append(comment);
    const help = doc.createElement('small');
    help.textContent = 'Saved with your Accept or Reject decision, not sent separately.';
    row.append(label, help);
  }

  renderItem(doc, card, item) {
    const row = doc.createElement('div');
    row.dataset.findingControls = '';
    row.dataset.finding = item.id;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${item.id} decision`);
    const outcome = doc.createElement('p');
    row.append(outcome);
    this.renderComment(doc, row, item);
    for (const action of ['accept', 'reject']) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.disabled = true;
      button.dataset.decision = action;
      button.textContent = action === 'accept' ? 'Accept' : 'Reject';
      button.setAttribute('aria-label', `${button.textContent} ${item.id}${action === 'accept' ? ' — authorize repair' : ''}`);
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.decide(action, item.id);
      });
      row.append(button);
    }
    card.append(row);
    this.rows.set(item.id, { row, outcome });
  }

  controls(blocked, ready, status) {
    if (!this.review || this.review.publication_only) return null;
    this.mount();
    const stale = this.review.needs_review || this.frame.dataset.revision !== this.review.revision;
    const missing = this.rows.size !== this.review.items.length;
    for (const item of this.review.items) {
      const controls = this.rows.get(item.id);
      if (!controls) continue;
      controls.outcome.textContent = item.decision === 'accept' ? 'Accepted — repair authorized'
        : item.decision === 'reject' ? 'Rejected — no repair authorized' : 'Undecided — no repair authorized';
      for (const control of controls.row.querySelectorAll('[data-decision], [data-finding-comment]')) {
        control.disabled = blocked || !ready || stale || missing || !!item.decision;
      }
    }
    if (stale && this.frame.dataset.revision) return 'Report changed. Saved decisions do not authorize this version; obtain a fresh review.';
    if (missing && ready) return 'Finding controls could not be matched to the report. Obtain a fresh review.';
    if (status === 'decided') return this.review.items.length
      ? 'All findings decided. Only accepted findings authorize repairs.' : 'No findings to decide. No repair authority was granted.';
    if (status === 'declined') return 'Review ended. Saved accept decisions still authorize their repairs.';
    return null;
  }
}

// Runtime-owned controls, not saved report content; the inert iframe still cannot run scripts.
const FINDING_CONTROL_STYLE = `
[data-finding-controls] { border-top: 1px solid #cad3e2; margin-top: 16px; padding-top: 12px; }
[data-finding-controls] p { font: 500 13px/1.5 system-ui,sans-serif; margin: 0 0 10px; }
[data-finding-controls] label, [data-finding-controls] small { display: block; font: 13px/1.5 system-ui,sans-serif; margin-bottom: 8px; }
[data-finding-controls] textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 5px; padding: 8px; border: 1px solid #8996ab; border-radius: 6px; font: 14px/1.5 system-ui,sans-serif; background: transparent; color: inherit; resize: vertical; }
[data-finding-controls] button { font: 600 14px/1.4 system-ui,sans-serif; border: 1px solid currentColor; border-radius: 7px; background: transparent; padding: 8px 16px; margin: 0 8px 4px 0; cursor: pointer; }
[data-finding-controls] [data-decision="accept"] { color: #17633b; }
[data-finding-controls] [data-decision="reject"] { color: #9d293c; }
[data-finding-controls] button:disabled { cursor: default; opacity: .5; }
[data-finding-controls] button:focus-visible { outline: 3px solid #3066b5; outline-offset: 3px; }
@media(prefers-color-scheme:dark) {
  [data-finding-controls] { border-color: #48566b; }
  [data-finding-controls] [data-decision="accept"] { color: #a6e3a1; }
  [data-finding-controls] [data-decision="reject"] { color: #f38ba8; }
}`;
