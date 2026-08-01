/**
 * P1: stable-part incremental parsing for streaming Markdown.
 *
 * While a message streams, its text only grows at the tail. Splitting it at
 * block boundaries lets the UI re-run the remark/rehype pipeline for the
 * changed tail only, and skip React reconciliation + Prism tokenization for
 * the already-complete leading parts.
 *
 * Split rules (aligned with CommonMark + GFM as used by react-markdown):
 * - An unterminated code fence pulls everything from its opening line into
 *   the tail: fence content is ambiguous until the closing fence arrives.
 * - Otherwise the tail starts after the last blank line: a blank line is a
 *   hard block boundary, so everything before it parses independently of the
 *   growing tail. Continuous blocks (lists, blockquotes, tables, setext
 *   headings, indented code) contain no blank line inside their lines, so
 *   they are never split mid-block.
 * - Consecutive blank lines are collapsed when forming parts.
 */
export interface MarkdownStreamPart {
  /** Stable content key — equal text always maps to the same id. */
  id: string;
  /** Part text. For stable parts the same string object is reused across calls. */
  text: string;
  /** True for the final part, which still grows while streaming. */
  tail: boolean;
}

/** cyrb53 — fast, deterministic 53-bit hash, base-36 encoded. */
function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function makePart(
  text: string,
  tail: boolean,
  cache: Map<string, string> | undefined,
): MarkdownStreamPart {
  const id = hashString(text);
  if (cache) {
    const cached = cache.get(id);
    if (cached !== undefined) return { id, text: cached, tail };
    cache.set(id, text);
  }
  return { id, text, tail };
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits a Markdown document into stable leading parts and one growing tail.
 *
 * @param markdown normalized Markdown text (display math already expanded)
 * @param cache optional string interning map: stable parts that reappear
 *   (same content hash) return the identical string object, so React.memo
 *   comparisons can use reference equality and skip re-render.
 */
export function splitStableParts(
  markdown: string,
  cache?: Map<string, string>,
): MarkdownStreamPart[] {
  if (markdown.length === 0) return [];
  const lines = markdown.split(/\r?\n/);

  // Find the opening line of the last unterminated fence, mirroring the
  // fence state machine in lib/markdown.ts (normalizeDisplayMath).
  let fenceMarker = "";
  let fenceSize = 0;
  let inFence = false;
  let lastOpenFenceLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = FENCE_OPEN.exec(lines[i]);
    if (!inFence) {
      if (match) {
        fenceMarker = match[1][0];
        fenceSize = match[1].length;
        inFence = true;
        lastOpenFenceLine = i;
      }
    } else if (match && match[1][0] === fenceMarker && match[1].length >= fenceSize) {
      inFence = false;
      fenceMarker = "";
      fenceSize = 0;
      lastOpenFenceLine = -1;
    }
  }

  let tailStartLine: number;
  if (lastOpenFenceLine >= 0) {
    tailStartLine = lastOpenFenceLine;
  } else {
    let lastBlankLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "") lastBlankLine = i;
    }
    tailStartLine = lastBlankLine + 1; // 0 when no blank line → everything is tail
  }

  const stableLines = lines.slice(0, tailStartLine);
  const tailLines = lines.slice(tailStartLine);

  // Collapse consecutive blank lines and split the stable prefix into parts
  // at blank-line boundaries. Every part therefore ends on a hard block
  // boundary and parses independently of its successors.
  const parts: MarkdownStreamPart[] = [];
  let partLines: string[] = [];
  const flush = () => {
    while (partLines.length > 0 && partLines[partLines.length - 1] === "") partLines.pop();
    while (partLines.length > 0 && partLines[0] === "") partLines.shift();
    if (partLines.length > 0) {
      parts.push(makePart(partLines.join("\n"), false, cache));
      partLines = [];
    }
  };
  for (const line of stableLines) {
    if (line === "" && partLines.length > 0) flush();
    else partLines.push(line);
  }
  if (partLines.length > 0) flush();

  // Keep the tail trimmed of leading blank lines (they are only separators),
  // but never of trailing content — the tail is still growing.
  while (tailLines.length > 0 && tailLines[0] === "") tailLines.shift();
  if (tailLines.length > 0) {
    parts.push(makePart(tailLines.join("\n"), true, cache));
  }
  return parts;
}
