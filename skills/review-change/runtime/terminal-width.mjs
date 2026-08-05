const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function terminalDisplayWidth(value) {
  let width = 0;
  for (const grapheme of graphemes(value)) {
    if (/^\p{Mark}+$/u.test(grapheme)) continue;
    const codePoint = grapheme.codePointAt(0) ?? 0;
    const wide = /\p{Extended_Pictographic}/u.test(grapheme)
      || codePoint >= 0x1100 && (
        codePoint <= 0x115f
        || codePoint >= 0x2e80 && codePoint <= 0xa4cf
        || codePoint >= 0xac00 && codePoint <= 0xd7a3
        || codePoint >= 0xf900 && codePoint <= 0xfaff
        || codePoint >= 0xfe10 && codePoint <= 0xfe6f
        || codePoint >= 0xff00 && codePoint <= 0xff60
        || codePoint >= 0xffe0 && codePoint <= 0xffe6
      );
    width += wide ? 2 : 1;
  }
  return width;
}

export function graphemes(value) {
  if (!GRAPHEME_SEGMENTER) return Array.from(String(value));
  return Array.from(GRAPHEME_SEGMENTER.segment(String(value)), ({ segment }) => segment);
}
