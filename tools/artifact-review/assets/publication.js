'use strict';

class PublicationControls {
  constructor(frame, request, persist, onStatus) {
    this.onStatus = onStatus;
    this.frame = frame;
    this.request = request;
    this.persist = persist;
    this.binding = null;
    this.state = null;
    this.busy = false;
    this.publishing = false;
    this.error = '';
    this.drafts = {};
    this.document = null;
    this.rows = new Map();
  }

  update(binding) {
    const next = binding?.publication_only ? binding : null;
    const changed = next?.report_digest !== this.binding?.report_digest;
    if (changed && next && this.binding) {
      this.drafts = {};
      this.persist();
    }
    this.binding = next;
    if (changed) { this.state = next ? { status: 'loading' } : null; this.error = ''; void this.refresh(); }
    this.controls();
  }

  key(id) { return `${this.binding.report_digest}:${id}`; }

  mount() {
    const doc = this.frame.contentDocument;
    if (!this.binding || !this.frame.dataset.revision || !doc) return;
    if (doc !== this.document) {
      this.document = doc;
      this.rows.clear();
      const style = doc.createElement('style');
      style.textContent = PUBLICATION_STYLE;
      doc.head.append(style);
      this.renderFooter(doc);
    }
    if (!this.state?.available || this.state.status === 'posted' || this.rows.size) return;
    for (const item of this.state.items) {
      const matches = doc.querySelectorAll(`[id="${item.id}"]`);
      if (matches.length === 1 && matches[0].tagName === 'ARTICLE') this.renderItem(doc, matches[0], item);
    }
  }

  renderItem(doc, card, item) {
    const row = doc.createElement('div');
    row.dataset.findingControls = '';
    row.dataset.publicationCommentRow = '';
    const label = doc.createElement('label');
    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox'; checkbox.dataset.publishFinding = item.id;
    const draft = this.drafts[this.key(item.id)];
    checkbox.checked = !!draft?.checked && item.inline;
    label.append(checkbox, doc.createTextNode(' Include this comment'));
    const location = doc.createElement('p');
    location.textContent = `${item.path} · ${item.side} · line ${item.line ?? 'unknown'}`;
    const comment = doc.createElement('textarea');
    comment.dataset.publicationComment = item.id;
    comment.setAttribute('aria-label', `Comment for ${item.title}`);
    comment.rows = 10; comment.maxLength = 8000;
    comment.value = draft?.body ?? item.body;
    const changed = () => {
      this.drafts[this.key(item.id)] = { checked: checkbox.checked, body: comment.value };
      this.error = ''; this.persist(); this.controls();
    };
    checkbox.addEventListener('change', changed);
    comment.addEventListener('input', changed);
    row.append(label, location, comment);
    if (!item.inline) {
      const warning = doc.createElement('p');
      warning.textContent = 'No verified inline location. Obtain a fresh review; this comment cannot be published elsewhere.';
      row.append(warning);
    }
    card.append(row);
    this.rows.set(item.id, { row, checkbox, comment, item });
  }

  renderFooter(doc) {
    this.footer = doc.createElement('footer');
    this.footer.dataset.findingControls = '';
    this.footer.dataset.publicationFooter = '';
    const heading = doc.createElement('h2'); heading.textContent = 'Publish selected comments';
    this.account = doc.createElement('p'); this.account.dataset.publicationAccount = '';
    const details = doc.createElement('details');
    const summary = doc.createElement('summary'); summary.textContent = 'Reviewed revisions';
    this.revisions = doc.createElement('code'); details.append(summary, this.revisions);
    this.notice = doc.createElement('p'); this.notice.dataset.publicationStatus = '';
    this.notice.setAttribute('role', 'status'); this.notice.setAttribute('aria-live', 'polite');
    this.check = doc.createElement('button'); this.check.type = 'button';
    this.check.textContent = 'Check publication status';
    this.check.addEventListener('click', () => this.refresh(true));
    this.publishButton = doc.createElement('button'); this.publishButton.type = 'button';
    this.publishButton.dataset.publicationPublish = ''; this.publishButton.textContent = 'Publish';
    this.publishButton.addEventListener('click', () => this.publish());
    this.footer.append(heading, this.account, details, this.notice, this.check, this.publishButton);
    doc.body.append(this.footer);
  }

  selected() {
    return [...this.rows].filter(([, row]) => row.checkbox.checked)
      .map(([id, row]) => ({ id, body: row.comment.value }));
  }

  controls() {
    this.onStatus();
    if (!this.binding) return;
    this.mount();
    if (!this.footer) return;
    const current = !this.binding.needs_review && this.frame.dataset.revision === this.binding.revision;
    const ready = this.state?.status === 'ready';
    const posted = this.state?.status === 'posted';
    const empty = this.state?.available && this.state.items.length === 0;
    const selected = this.selected();
    const valid = selected.every(comment => comment.body.trim() && new TextEncoder().encode(comment.body).length <= 8000);
    const missing = this.state?.available && this.rows.size !== this.state.items.length;
    for (const row of this.rows.values()) {
      row.row.hidden = posted;
      row.checkbox.disabled = this.busy || !current || !ready || !row.item.inline;
      row.comment.disabled = this.busy || !current || !ready;
    }
    this.publishButton.disabled = this.busy || !current || !ready || !this.state?.account || missing || !selected.length || !valid;
    this.publishButton.textContent = this.publishing ? 'Publishing…' : 'Publish';
    this.check.hidden = !this.error && !['uncertain', 'unavailable'].includes(this.state?.status);
    this.check.disabled = this.busy;
    this.account.textContent = posted ? `Published to ${this.state.url}`
      : empty ? `No findings to publish · ${this.state.url}`
      : `${this.state?.account?.login || 'Waiting for GitHub account'} · ${this.state?.url || 'PR report'}`;
    this.revisions.textContent = `${this.state?.base || ''} → ${this.state?.head || ''}`;
    this.notice.textContent = this.error || (posted ? 'Published. See the PR for the submitted comments.'
      : !current ? 'Report changed. Do not resubmit; reconcile any existing attempt from the original unchanged report before starting another review.'
      : empty ? 'No findings to publish. The sidebar remains available for feedback.'
      : missing ? 'Finding controls could not be matched to the report. Obtain a fresh review.'
      : !valid ? 'Selected comments must contain 1–8000 UTF-8 bytes.'
      : this.state?.status === 'unavailable' ? 'Publication unavailable. Check status before trying again; the PR link remains available.'
      : this.state?.status === 'uncertain' ? 'Outcome uncertain. Check the existing attempt; do not resubmit.'
      : `Select comments above. Publish sends their exact text to the displayed file and line (${selected.length} selected). This posts comments only, never PR approval or requested changes.`);
  }

  async refresh(reconcile = false) {
    if (!this.binding || this.busy) return;
    this.busy = true; this.controls();
    try {
      let state = await this.request('/publication', undefined, 180000);
      if (reconcile && state.status === 'uncertain') state = await this.request('/publication/reconcile', {}, 180000);
      this.state = state; this.error = '';
    } catch (error) {
      this.error = error.message;
      if (!['posted', 'uncertain'].includes(this.state?.status)) this.state = { ...this.state, status: 'unavailable' };
    } finally { this.busy = false; this.controls(); }
  }

  async publish() {
    if (this.publishButton.disabled) return;
    const selection = { comments: this.selected(), account: this.state.account, base: this.state.base, head: this.state.head };
    this.busy = true; this.publishing = true; this.error = ''; this.controls();
    try {
      // One human click confirms the visible comments, targets, account and PR.
      // Prepare/confirm retain the signed backend attempt and race checks, not a second UI step.
      const preview = await this.request('/publication/preview', selection, 180000);
      this.state = await this.request('/publication/confirm', { token: preview.token }, 180000);
    } catch (error) {
      this.error = `${error.message} Check publication status before trying again.`;
      this.state = { ...this.state, status: 'uncertain' };
    } finally { this.busy = false; this.publishing = false; this.controls(); }
  }
}

const PUBLICATION_STYLE = `
[data-publication-comment-row] { border-top: 1px solid #8996ab; margin-top: 18px; padding-top: 14px; }
[data-publication-comment-row] label { font: 600 15px/1.5 system-ui,sans-serif; }
[data-publication-comment-row] p { font: 13px/1.5 system-ui,sans-serif; overflow-wrap: anywhere; }
[data-publication-comment] { display: block; width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #8996ab; border-radius: 6px; background: transparent; color: inherit; font: 14px/1.6 ui-monospace,monospace; resize: vertical; }
[data-publication-footer] { box-sizing: border-box; max-width: 920px; margin: 24px auto; padding: 24px; border-top: 2px solid #3066b5; overflow-wrap: anywhere; }
[data-publication-footer] button { font: 600 16px/1.5 system-ui,sans-serif; padding: 10px 24px; border: 1px solid #3066b5; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; }
[data-publication-footer] button:disabled { opacity: .5; cursor: default; }
[data-publication-footer] [data-publication-publish] { display: block; margin-top: 18px; }
[data-publication-comment]:focus-visible, [data-publication-footer] button:focus-visible { outline: 3px solid #3066b5; outline-offset: 3px; }
`;
