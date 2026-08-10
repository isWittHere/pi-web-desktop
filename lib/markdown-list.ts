/**
 * Markdown line-structure continuation for the chat input. When the user
 * wraps to a new line (Enter in ctrl-enter mode, or Shift+Enter), the current
 * line's leading structural prefix is re-emitted so list items, blockquotes
 * and task checkboxes can be typed continuously without re-typing the marker.
 *
 * Tier 1 scope: unordered (`-`/`*`/`+`) and ordered (`1.`/`1)`) lists, task
 * checkboxes (`- [ ]`), blockquotes (`>`, nested `>>`), and combinations of
 * indent + quotes + list marker. Returns null when the line has no structural
 * prefix, letting the caller fall back to a plain newline.
 */

export interface MarkdownContinuation {
  value: string;
  caret: number;
}

const LIST_MARKER = /^([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;
const QUOTE_MARKER = /^(?:>\s*)+/;
const ORDERED_MARKER = /^\d+[.)]$/;

export function continueMarkdownList(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownContinuation | null {
  // Enter replaces the selected range first; the caret base is its start.
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const base = start;
  const effective = end > start
    ? value.slice(0, start) + value.slice(end)
    : value;

  const lineStart = effective.lastIndexOf("\n", base - 1) + 1;
  const line = effective.slice(lineStart, base);

  const indent = line.match(/^\s*/)?.[0] ?? "";
  let rest = line.slice(indent.length);
  const quotes = rest.match(QUOTE_MARKER)?.[0] ?? "";
  rest = rest.slice(quotes.length);
  const list = rest.match(LIST_MARKER);

  if (!quotes && !list) return null;

  const prefix = indent + quotes + (list?.[0] ?? "");

  // An empty item ends the structure: drop the whole prefix so typing
  // continues on a fresh, marker-free line (matches VS Code/Typora).
  if (line.slice(prefix.length).trim() === "") {
    return {
      value: effective.slice(0, lineStart) + effective.slice(lineStart + prefix.length),
      caret: lineStart,
    };
  }

  // Otherwise re-emit the prefix on the next line: ordered numbers increment,
  // task checkboxes reset to unchecked.
  let nextPrefix = indent + quotes;
  if (list) {
    const marker = list[1];
    nextPrefix += ORDERED_MARKER.test(marker)
      ? `${parseInt(marker, 10) + 1}${marker.slice(-1)} `
      : `${marker} `;
    if (list[3]) nextPrefix += "[ ] ";
  }

  const insert = `\n${nextPrefix}`;
  return {
    value: effective.slice(0, base) + insert + effective.slice(base),
    caret: base + insert.length,
  };
}
