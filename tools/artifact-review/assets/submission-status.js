'use strict';

class SubmissionStatus {
  constructor(frame) {
    this.frame = frame;
    this.submitted = null;
    this.replyCursor = 0;
    this.banner = document.querySelector('#submission-status');
  }

  event(event) {
    if (event.action === 'reopen') { this.submitted = null; this.replyCursor = 0; }
    if (['feedback', 'accept', 'reject'].includes(event.action)) this.submitted = event;
    if (event.action === 'reply') this.replyCursor = event.cursor;
  }

  feedbackState(review) {
    if (!this.submitted || !this.frame.dataset.revision || (review?.publication_only && this.submitted.finding)) return null;
    if (this.submitted.revision !== this.frame.dataset.revision) return {
      state: 'updated', heading: 'UPDATED — Review this version',
      detail: 'The document changed after your submission. Earlier feedback remains in the sidebar.',
    };
    return {
      state: 'submitted', heading: this.submitted.finding ? 'SUBMITTED — Finding decision saved' : 'SUBMITTED — Waiting for agent',
      detail: this.replyCursor > this.submitted.cursor
        ? 'Agent replied in the sidebar. This is still the version you submitted; follow-up feedback remains available.'
        : 'Your feedback was saved for the agent. This is the submitted version; follow-up feedback remains available.',
    };
  }

  approvalState(status, approvedRevision) {
    if (status !== 'approved' || !this.frame.dataset.revision) return null;
    return this.frame.dataset.revision !== approvedRevision ? {
      state: 'changed', heading: 'CHANGED — Not approved',
      detail: 'The current document differs from the approved version. Open another review; this review is closed.',
    } : {
      state: 'completed', heading: 'COMPLETED — Approved',
      detail: 'Your approval was saved for the agent. This review is closed and remains readable for reference.',
    };
  }

  decisionState(status, review) {
    if (status === 'declined') return {
      state: 'completed', heading: 'COMPLETED — Review ended without approval',
      detail: review && !review.publication_only
        ? 'This review is closed. Saved accept decisions still authorize their repairs; the report remains readable for reference.'
        : 'This review is closed. The document remains readable for reference; ending a review does not publish comments.',
    };
    if (status !== 'decided') return null;
    return {
      state: 'completed', heading: 'COMPLETED — All findings decided',
      detail: 'Decisions were saved for the agent. Only accepted findings authorize repairs; this is not blanket code approval.',
    };
  }

  publicationState(publication, publishing, review) {
    if (publishing) return {
      state: 'submitting', heading: 'SUBMITTING — Publication in progress',
      detail: 'Wait for a confirmed outcome. Do not submit these comments from another report.',
    };
    if (review?.publication_only && (!publication || publication.status === 'loading')) return {
      state: 'loading', heading: 'CHECKING — Publication status',
      detail: 'The review may be closed, but its publication outcome is not known yet. Wait for the saved attempt status.',
    };
    if (publication?.status === 'unavailable') return {
      state: 'unavailable', heading: 'NOT CONFIRMED — Publication status unavailable',
      detail: 'The publication outcome could not be checked. Use Check publication status below; do not assume completion or resubmit.',
    };
    if (publication?.status === 'uncertain') return {
      state: 'uncertain', heading: 'NOT CONFIRMED — Check publication status',
      detail: 'GitHub publication is not confirmed. Use Check publication status below this report to reconcile the existing attempt; do not resubmit.',
    };
    if (publication?.status !== 'posted') return null;
    return {
      state: 'completed', heading: 'COMPLETED — Comments published',
      detail: 'Selected comments were confirmed on GitHub. This report remains readable; sidebar feedback is separate and stays available until End review.',
    };
  }

  changedReportState(review, publication, publishing) {
    if (!review || !this.frame.dataset.revision || (!review.needs_review && review.revision === this.frame.dataset.revision)) return null;
    if (review.publication_only && (publishing || publication?.status !== 'posted')) return {
      state: 'uncertain', heading: 'CHANGED — Publication not confirmed',
      detail: 'The report changed and its publication outcome is not confirmed. Do not resubmit from this or another report. Reconcile any existing attempt using the original unchanged report first.',
    };
    return {
      state: 'changed', heading: 'CHANGED — Obtain a fresh review',
      detail: 'This document no longer matches the retained report. Saved decisions and publication context do not authorize this version.',
    };
  }

  render({ review, status, approvedRevision, publication, publishing }) {
    const state = this.changedReportState(review, publication, publishing) || this.publicationState(publication, publishing, review) || this.approvalState(status, approvedRevision)
      || this.decisionState(status, review) || this.feedbackState(review);
    const title = review ? 'Change review' : 'Review artifact';
    const labels = { completed: 'Completed', changed: 'Changed', updated: 'Updated', submitted: 'Submitted',
      uncertain: 'Not confirmed', unavailable: 'Not confirmed', loading: 'Checking', submitting: 'Submitting' };
    document.title = state ? `${labels[state.state]} · ${title}` : title;
    this.banner.hidden = !state;
    this.banner.dataset.state = state?.state || '';
    this.banner.querySelector('strong').textContent = state?.heading || '';
    this.banner.querySelector('p').textContent = state?.detail || '';
  }
}
