'use strict';

class AnnotationPopover {
  constructor(frame) {
    this.frame = frame;
    this.editor = document.querySelector('#annotation-editor');
    this.highlight = document.querySelector('#annotation-highlight');
    this.note = document.querySelector('#annotation-position-note');
    this.target = null;
    this.anchor = null;
    this.reposition = () => this.position();
    window.addEventListener('resize', this.reposition);
    window.addEventListener('scroll', this.reposition, true);
    this.resize = new ResizeObserver(this.reposition);
    this.resize.observe(this.editor);
    this.resize.observe(frame);
    this.editor.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      document.querySelector('#cancel-annotation').click();
    });
  }

  attach() {
    this.anchor = null;
    this.frame.contentWindow.addEventListener('scroll', this.reposition, true);
    this.position();
  }

  update(target, anchor) {
    if (this.target && !target) this.frame.contentDocument?.getSelection()?.removeAllRanges();
    if (target !== this.target) this.anchor = anchor || null;
    this.target = target;
    this.position();
  }

  anchorRect() {
    if (this.target.revision !== this.frame.dataset.revision) return null;
    const doc = this.frame.contentDocument;
    if (!this.anchor && this.target.kind === 'element') {
      try {
        const matches = doc.querySelectorAll(this.target.target);
        this.anchor = matches.length === 1 ? matches[0] : null;
      } catch { return null; }
    }
    const node = this.anchor?.commonAncestorContainer || this.anchor;
    if (!node?.isConnected || node.ownerDocument !== doc) return null;
    const rect = this.anchor.getBoundingClientRect();
    const origin = this.frame.getBoundingClientRect();
    return { left: origin.left + rect.left, right: origin.left + rect.right,
      top: origin.top + rect.top, bottom: origin.top + rect.bottom };
  }

  hide() {
    const focused = this.editor.contains(document.activeElement);
    this.editor.hidden = true;
    this.highlight.hidden = true;
    if (focused) this.frame.focus({ preventScroll: true });
  }

  position() {
    if (!this.target) { this.anchor = null; this.hide(); return; }
    const area = annotationIntersection(this.frame.getBoundingClientRect(), {
      left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8,
    });
    if (!area || area.right - area.left < 60 || area.bottom - area.top < 80) { this.hide(); return; }
    const anchor = this.anchorRect();
    const visible = anchor && annotationIntersection(anchor, area);
    this.showHighlight(visible);
    this.note.hidden = !!visible;
    this.note.textContent = this.target.revision !== this.frame.dataset.revision
      ? 'This draft belongs to an earlier or unloaded revision; its original target is retained.'
      : 'Cannot show the original selection here. Your draft is retained; scroll back if its target is offscreen.';
    this.editor.hidden = false;
    this.editor.style.width = `${Math.min(340, area.right - area.left - 16)}px`;
    this.editor.style.maxHeight = `${area.bottom - area.top - 16}px`;
    const size = this.editor.getBoundingClientRect();
    const position = annotationPlacement(visible, area, size);
    this.editor.style.left = `${position.left}px`;
    this.editor.style.top = `${position.top}px`;
  }

  showHighlight(rect) {
    this.highlight.hidden = !rect;
    if (!rect) return;
    Object.assign(this.highlight.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px`,
    });
  }
}

function annotationIntersection(a, b) {
  const rect = { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
}

function annotationPlacement(anchor, area, size) {
  const gap = 8;
  const minLeft = area.left + gap, maxLeft = area.right - size.width - gap;
  const minTop = area.top + gap, maxTop = area.bottom - size.height - gap;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  if (anchor) {
    const left = clamp(anchor.left, minLeft, maxLeft);
    const top = clamp(anchor.top, minTop, maxTop);
    const candidates = [
      { left, top: anchor.bottom + gap }, { left, top: anchor.top - size.height - gap },
      { left: anchor.right + gap, top }, { left: anchor.left - size.width - gap, top },
    ];
    const fitting = candidates.find(p => p.left >= minLeft && p.left <= maxLeft && p.top >= minTop && p.top <= maxTop);
    if (fitting) return fitting;
  }
  return { left: clamp(anchor?.left ?? maxLeft, minLeft, maxLeft),
    top: clamp(anchor?.bottom ?? minTop, minTop, maxTop) };
}
