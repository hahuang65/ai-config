'use strict';

class PublicationControls {
  constructor(frame, request) {
    this.frame = frame;
    this.request = request;
    this.binding = null;
    this.preview = null;
    this.busy = false;
    this.state = null;
    this.root = document.querySelector('#publication');
    this.selection = document.querySelector('#publication-items');
    this.notice = document.querySelector('#publication-status');
    this.previewButton = document.querySelector('#publication-preview');
    this.confirmButton = document.querySelector('#publication-confirm');
    this.previewButton.addEventListener('click', () => this.prepare());
    this.confirmButton.addEventListener('click', () => this.confirm());
    document.querySelector('#publication-cancel').addEventListener('click', () => this.invalidate());
    document.querySelector('#publication-refresh').addEventListener('click', () => this.refresh(true));
    this.selection.addEventListener('change', () => this.invalidate());
  }

  update(binding) {
    const next = binding ? `${binding.report_digest}:${binding.revision}` : '';
    const previous = this.binding ? `${this.binding.report_digest}:${this.binding.revision}` : '';
    this.binding = binding;
    if (next !== previous) {
      this.preview = null;
      this.refresh();
    }
    this.controls();
  }

  controls() {
    const current = this.binding && !this.binding.needs_review
      && this.frame.dataset.revision === this.binding.revision;
    const ready = this.state?.status === 'ready';
    const ids = [...this.selection.querySelectorAll('input:checked')];
    this.previewButton.disabled = this.busy || !current || !ready || !ids.length;
    this.confirmButton.disabled = this.busy || !current || !ready || !this.preview;
    for (const input of this.selection.querySelectorAll('input')) input.disabled = this.busy || !current || !ready;
    if (!current) this.invalidate();
  }

  invalidate() {
    this.preview = null;
    document.querySelector('#publication-request').textContent = '';
    this.confirmButton.disabled = true;
  }

  async refresh(reconcile = false) {
    if (!this.binding || this.busy) return;
    this.busy = true;
    this.controls();
    try {
      let state = await this.request('/publication', undefined, 180000);
      if (reconcile && state.status === 'uncertain') {
        state = await this.request('/publication/reconcile', {}, 180000);
      }
      this.state = state;
      this.root.hidden = !state.available;
      if (!state.available) return;
      this.selection.replaceChildren();
      for (const item of state.items) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox'; input.checked = true; input.dataset.publishFinding = item.id;
        label.append(input, document.createTextNode(` ${item.id} · ${item.title}`));
        this.selection.append(label);
      }
      this.notice.textContent = state.status === 'posted' ? 'Posted — comment-only review confirmed.'
        : state.status === 'uncertain' ? 'Outcome uncertain. Check the existing attempt; do not create another submission.'
        : 'Select comments, preview the exact request, then confirm publication. Repair decisions do not publish.';
      this.invalidate();
    } catch (error) {
      this.notice.textContent = error.message;
      this.invalidate();
    } finally { this.busy = false; this.controls(); }
  }

  async prepare() {
    if (this.previewButton.disabled) return;
    this.busy = true; this.invalidate(); this.controls();
    try {
      const ids = [...this.selection.querySelectorAll('input:checked')].map(input => input.dataset.publishFinding);
      this.preview = await this.request('/publication/preview', { ids }, 180000);
      document.querySelector('#publication-request').textContent = JSON.stringify({
        account: this.preview.account, pullRequest: this.preview.url,
        base: this.preview.base, head: this.preview.head, request: this.preview.request,
      }, null, 2);
      this.notice.textContent = 'Inspect this exact request. Publish comments is the final human confirmation; it never approves or requests changes.';
    } catch (error) { this.notice.textContent = error.message; }
    finally { this.busy = false; this.controls(); }
  }

  async confirm() {
    if (this.confirmButton.disabled) return;
    const token = this.preview.token;
    this.busy = true; this.controls();
    try {
      this.state = await this.request('/publication/confirm', { token }, 180000);
      this.invalidate();
      this.notice.textContent = 'Posted — comment-only review confirmed.';
    } catch (error) {
      this.notice.textContent = `${error.message} Check publication status before retrying.`;
      this.invalidate();
    } finally { this.busy = false; this.controls(); }
  }
}
