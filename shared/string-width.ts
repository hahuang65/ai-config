// Terminal display-column measurement shared by the pi footer and the Claude statusline.
// No width API exists in both runtimes (Bun.stringWidth is Bun-only, and pi runs under
// Node), so widths come from grapheme clusters classified against wide Unicode ranges.

export const ANSI_ESCAPE = /\[[0-9;]*m/g;

const WIDE_GRAPHEME = new RegExp(
  [
    "\\p{Emoji_Presentation}",
    "\\uFE0F", // emoji variation selector renders the base character as a wide emoji
    "[\\u1100-\\u115F\\u2E80-\\u303E\\u3041-\\u33FF\\u3400-\\u4DBF\\u4E00-\\u9FFF]",
    "[\\uA000-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6]",
    "[\\u{1F300}-\\u{1F64F}\\u{1F900}-\\u{1F9FF}\\u{20000}-\\u{3FFFD}]",
  ].join("|"),
  "u",
);

const graphemeSegmenter = new Intl.Segmenter();

export function stringWidth(value: string): number {
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(value)) {
    width += WIDE_GRAPHEME.test(segment) ? 2 : 1;
  }
  return width;
}

export function visibleWidth(value: string): number {
  return stringWidth(value.replace(ANSI_ESCAPE, ""));
}

// CLI mode for shell callers: print the display width of each argument, one per line.
if (import.meta.main) {
  for (const argument of process.argv.slice(2)) {
    // Print as a string: Bun colorizes numbers passed to console.log with ANSI codes.
    console.log(String(visibleWidth(argument)));
  }
}
