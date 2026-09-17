import crypto from "node:crypto";

import { publicationErrorContent } from "./review-publication-outcomes.mjs";
import { escapeHtml } from "./review-publication-protocol.mjs";

const CONFIRMATION_PATH = "/api/v1/review-publication-confirmations";
const SELECTION_SCRIPT = `(()=>{const boxes=[...document.querySelectorAll('input[name="selected_finding_id"]')];const output=document.querySelector('#publication-general-comment');const count=document.querySelector('#publication-selected-count');function update(){const selected=boxes.filter(box=>box.checked).map(box=>box.closest('[data-finding-id]').querySelector('strong').textContent);count.textContent=String(selected.length);output.textContent=selected.length===0?'Review completed. No Findings were selected for publication.':'Review found '+selected.length+' '+(selected.length===1?'issue':'issues')+' worth addressing:\\n\\n'+selected.map(title=>'- '+title).join('\\n')}boxes.forEach(box=>box.addEventListener('change',update));document.querySelector('[data-initial-focus]')?.focus();update()})()`;
const PAGE_SCRIPT = `document.querySelector('[data-initial-focus]')?.focus();const change=document.querySelector('#change-selection');const form=document.querySelector('form');change?.addEventListener('click',()=>history.back());form?.addEventListener('submit',()=>{const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true})`;

export const PUBLICATION_SCRIPT_HASH = crypto.createHash("sha256").update(PAGE_SCRIPT).digest("base64");

const STYLE = `
:root{color-scheme:dark;--bg:#0c111b;--panel:#131b29;--panel2:#192438;--line:#2b3b55;--text:#edf3fc;--muted:#a9b8cd;--blue:#78b2ff;--green:#70dda5;--amber:#f2c66d;--red:#ff8999}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -10%,#19345b 0,transparent 35%),var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.publication-page{width:min(100% - 32px,980px);margin:0 auto;padding:48px 0 72px}.publication-panel{border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,var(--panel2),var(--panel));box-shadow:0 22px 70px #02050a99;overflow:hidden}.publication-head,.publication-body,.publication-actions{padding:24px}.publication-head{border-bottom:1px solid var(--line)}.publication-body{display:grid;gap:18px}.publication-selection{display:grid;gap:18px}.publication-selection-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start}.publication-findings{display:grid;gap:12px;min-width:0;margin:0;border:0;padding:24px}.publication-summary{position:sticky;top:16px}.publication-summary .publication-body{gap:14px}.publication-count{margin:0;font-size:1.05rem}.publication-count output{font-size:1.8rem;font-weight:800}.publication-confirmation-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}.publication-confirmation-details,.publication-confirmation-comments{min-width:0}.publication-actions{display:flex;justify-content:flex-end;gap:12px;border-top:1px solid var(--line)}.publication-eyebrow{margin:0 0 8px;color:var(--blue);font-size:.75rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}h1,h2,h3,p{overflow-wrap:anywhere}h1{margin:0;font-size:clamp(2rem,7vw,3.5rem);line-height:1.05}h2{margin:0 0 8px}h3{margin:0}.publication-lead,.publication-muted{color:var(--muted)}.publication-finding,.publication-preview,.publication-facts,.publication-notice{border:1px solid var(--line);border-radius:13px;background:#0f1724;padding:16px}.publication-finding{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px}.publication-finding input{width:20px;height:20px;margin-top:4px}.publication-finding strong{display:block;font-size:1.05rem}.finding-anchor{display:block;color:var(--muted);font:13px ui-monospace,SFMono-Regular,monospace}.publication-preview{white-space:pre-wrap}.publication-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 16px;margin:0}.publication-facts dt{color:var(--muted)}.publication-facts dd{margin:0;font-weight:650}.publication-notice{border-color:#386b50;background:#10251c}.publication-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid #45658f;border-radius:10px;background:#17263c;color:var(--text);padding:10px 16px;font-weight:750;text-decoration:none}.publication-button.primary{border-color:#5795ed;background:#3678e5}.publication-button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:3px}.publication-terminal{text-align:center;padding:44px 24px}.publication-terminal .publication-icon{display:grid;width:58px;height:58px;margin:0 auto 18px;place-items:center;border:2px solid currentColor;border-radius:50%;font-size:1.7rem;font-weight:850}.publication-terminal.success{color:var(--green)}.publication-terminal.stale{color:var(--amber)}.publication-terminal.error{color:var(--red)}.publication-terminal h1,.publication-terminal p,.publication-terminal a{color:var(--text)}.publication-secondary{font-size:.82rem;color:var(--muted)}@media(max-width:800px){.publication-selection-grid,.publication-confirmation-grid{grid-template-columns:1fr}.publication-summary{position:static}}@media(max-width:600px){.publication-page{width:min(100% - 20px,980px);padding:20px 0}.publication-head,.publication-body,.publication-actions,.publication-findings{padding:18px}.publication-actions{align-items:stretch;flex-direction:column-reverse}.publication-button{width:100%}.publication-facts{grid-template-columns:1fr;gap:3px}.publication-facts dd{margin-bottom:9px}}
`;

export function renderPublicationForm({ publicationToken, findings, review = selectionReview(findings), publisherUrl = "http://127.0.0.1:4392" }) {
  return page("Review publication", renderSelection({
    publicationToken,
    findings,
    review,
    action: `${publisherUrl}${CONFIRMATION_PATH}`,
    headingLevel: 1,
  }), SELECTION_SCRIPT);
}

export function renderPublicationFragment({ publicationToken, findings, review = selectionReview(findings), publisherUrl = "http://127.0.0.1:4392" }) {
  return `<style data-review-publication-styles>${STYLE}</style><section aria-labelledby="review-publication-heading">${renderSelection({
    publicationToken,
    findings,
    review,
    action: `${publisherUrl}${CONFIRMATION_PATH}`,
    headingLevel: 2,
  })}</section><script>${SELECTION_SCRIPT}</script>`;
}

export function renderConfirmationPage(claims, review, confirmationToken) {
  const comments = review.findings.map((finding) => `<article class="publication-preview"><h3>${escapeHtml(finding.title)}</h3><span class="finding-anchor">${escapeHtml(finding.path)}:${finding.line}</span><p>${escapeHtml(finding.body)}</p></article>`).join("");
  const content = `<main class="publication-page" data-review-publication-state="confirmation"><div class="publication-panel"><header class="publication-head"><p class="publication-eyebrow">Browser review</p><h1 tabindex="-1" data-initial-focus>Post this review to GitHub?</h1><p class="publication-lead">Nothing has been posted yet. Check the account, pull request, and selected comments. The final action opens a separate operating-system confirmation.</p></header><div class="publication-body publication-confirmation-grid"><section class="publication-confirmation-details" aria-labelledby="details-heading"><h2 id="details-heading">Publication details</h2><dl class="publication-facts"><dt>GitHub account</dt><dd>@${escapeHtml(claims.actor.login)}</dd><dt>Destination</dt><dd>${escapeHtml(claims.repository.nameWithOwner)} · PR #${claims.pullRequest.number}</dd><dt>Review type</dt><dd>Comment only</dd><dt>Selected scope</dt><dd>Base ${escapeHtml(shortOid(claims.scope.baseOid))} · Head ${escapeHtml(shortOid(claims.scope.headOid))}</dd></dl><div class="publication-notice"><strong>The pull request still matches this report.</strong><p class="publication-muted">The pull request is open and both commits are unchanged.</p></div></section><section class="publication-confirmation-comments" aria-labelledby="comments-heading"><h2 id="comments-heading">Comments to publish</h2><article class="publication-preview"><h3>General comment</h3><p>${escapeHtml(review.generalComment)}</p></article>${comments}</section></div><div class="publication-actions"><button class="publication-button" id="change-selection" type="button">← Change selection</button><form method="post" action="/api/v1/review-publications"><input type="hidden" name="confirmation_token" value="${escapeHtml(confirmationToken)}"><button class="publication-button primary" type="submit">Post review to GitHub</button></form></div></div></main>`;
  return page("Confirm Review publication", content, PAGE_SCRIPT);
}

export function renderSuccessPage(claims, providerReview, { cleanupTrouble = false } = {}) {
  const cleanupNotice = cleanupTrouble
    ? '<p class="publication-secondary">Local publication cleanup did not finish. The review is posted. Wait before retrying; a later retry will reconcile the exact review.</p>'
    : "";
  const content = `<main class="publication-page" data-review-publication-state="posted"><div class="publication-panel publication-terminal success"><div class="publication-icon" aria-hidden="true">✓</div><h1 tabindex="-1" data-initial-focus>Review posted.</h1><p>GitHub accepted the comment review for ${escapeHtml(claims.repository.nameWithOwner)} · PR #${claims.pullRequest.number}.</p><p class="publication-secondary">Posted by @${escapeHtml(claims.actor.login)} · Review #${escapeHtml(providerReview.reviewId)}</p>${cleanupNotice}<a class="publication-button primary" href="${escapeHtml(providerReview.url)}">Open review on GitHub</a></div></main>`;
  return page("Review posted", content, PAGE_SCRIPT);
}

export function renderErrorPage(code, details = {}) {
  const stale = new Set(["pull_request_scope_changed", "invalid_inline_location"]).has(code);
  const content = errorContent(code, details);
  const state = stale ? "stale" : "error";
  return page("Review publication error", `<main class="publication-page" data-review-publication-state="${state}" data-publication-error="${escapeHtml(code)}"><div class="publication-panel publication-terminal ${state}"><div class="publication-icon" aria-hidden="true">!</div><h1 tabindex="-1" data-initial-focus>${escapeHtml(content.heading)}</h1><p>${escapeHtml(content.impact)}</p><p><strong>${escapeHtml(content.action)}</strong></p>${content.secondary ? `<p class="publication-secondary">${escapeHtml(content.secondary)}</p>` : ""}</div></main>`, PAGE_SCRIPT);
}

function renderSelection({ publicationToken, findings, review, action, headingLevel }) {
  const cards = findings.map((finding, index) => `<article class="publication-finding" data-finding-id="${escapeHtml(finding.id)}"><input ${index === 0 ? "data-initial-focus " : ""}type="checkbox" checked name="selected_finding_id" value="${escapeHtml(finding.id)}" aria-label="${escapeHtml(`${finding.title}, ${finding.path}:${finding.line}`)}"><div><strong>${escapeHtml(finding.title)}</strong><span class="finding-anchor">${escapeHtml(finding.path)}:${finding.line}</span><p>${escapeHtml(finding.body)}</p></div></article>`).join("");
  const heading = `h${headingLevel}`;
  const headingId = headingLevel === 2 ? " id=\"review-publication-heading\"" : "";
  const emptyFocus = findings.length === 0 ? " data-initial-focus" : "";
  return `<div class="publication-selection" data-review-publication-state="selection"><header class="publication-head"><p class="publication-eyebrow">Review publication</p><${heading}${headingId}>Select Findings</${heading}><p class="publication-lead">All Findings are selected. Clear any comment that should not be posted.</p></header><form id="review-publication-selection" method="post" action="${escapeHtml(action)}"><div class="publication-selection-grid"><section class="publication-panel publication-findings-panel" aria-labelledby="publication-findings-heading"><header class="publication-head"><h3 id="publication-findings-heading">Choose inline comments</h3><p class="publication-muted">Clear anything that should not be published.</p></header><fieldset class="publication-findings"><legend>Findings selected for publication</legend>${cards}</fieldset></section><aside class="publication-panel publication-summary" aria-labelledby="publication-summary-heading"><header class="publication-head"><h3 id="publication-summary-heading">General comment</h3><p class="publication-muted">Generated from the current selection and never edited by hand.</p></header><div class="publication-body"><p class="publication-count"><output id="publication-selected-count" role="status">${findings.length}</output> inline comments selected</p><output class="publication-preview" id="publication-general-comment">${escapeHtml(review.generalComment)}</output><p class="publication-muted">The general and inline comments stay read-only.</p></div><div class="publication-actions"><button class="publication-button primary"${emptyFocus} type="submit">Review before posting</button></div></aside></div><input type="hidden" name="publication_token" value="${escapeHtml(publicationToken)}"></form></div>`;
}

function errorContent(code, details) {
  const content = publicationErrorContent(code);
  if (code === "publication_outcome_unknown") return {
    ...content,
    secondary: "The publisher will use marker reconciliation before it tries to create another review.",
  };
  if (code === "github_actor_changed" && details.expectedActor && details.currentActor) return {
    ...content,
    impact: `No comments were posted because this report expected @${details.expectedActor}, but @${details.currentActor} is active.`,
    action: `Sign in to the GitHub command-line app as @${details.expectedActor}, then try again.`,
  };
  if (code === "invalid_inline_location") {
    const finding = details.details;
    const identifier = finding?.title
      ? `${finding.title} (${finding.findingId})`
      : finding?.findingId;
    const location = finding?.path && Number.isInteger(finding?.line)
      ? `${finding.path}:${finding.line}`
      : "the selected line";
    return identifier ? {
      ...content,
      impact: `No comments were posted because ${identifier} at ${location} is not in the reviewed changes.`,
    } : content;
  }
  if (["provider_unavailable", "provider_output_limit", "provider_timeout", "provider_failed"].includes(code)) {
    return {
      ...content,
      impact: details.phase === "publication"
        ? "No comments were posted because final publication stopped before GitHub could accept the review."
        : "No comments were posted because read-only confirmation could not finish.",
    };
  }
  return content;
}

function page(title, content, script = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style data-review-publication-styles>${STYLE}</style></head><body>${content}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function selectionReview(findings) {
  const count = findings.length;
  return {
    findings,
    generalComment: count === 0
      ? "Review completed. No Findings were selected for publication."
      : `Review found ${count} ${count === 1 ? "issue" : "issues"} worth addressing:\n\n${findings.map((finding) => `- ${finding.title}`).join("\n")}`,
  };
}

function shortOid(value) { return value.slice(0, 8); }
