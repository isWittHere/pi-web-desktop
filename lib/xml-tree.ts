/**
 * Tolerant XML-tree parser for pi system prompts.
 *
 * Pi's system prompt is not well-formed XML: it interleaves XML wrapper
 * tags (`<environment>`, `<project_context>`, `<skills>`, ...) with plain
 * markdown, and may contain XML-looking samples inside fenced code blocks
 * that must NOT be parsed as structure. This scanner:
 * - pairs open/close tags with a stack, merging orphans back to their
 *   nearest matching open tag on close
 * - degrades unmatched close tags / bare "<" to text
 * - treats fenced code block (``` / ~~~) content as plain text (fence-aware)
 * - parses self-closing `<tag/>` as leaves
 */

export interface XmlTextNode {
  kind: "text";
  raw: string;
}

export interface XmlTreeElement {
  kind: "xml";
  tag: string;
  attrs?: string;
  children: Array<XmlTreeElement | XmlTextNode>;
  raw: string;
  selfClosing: boolean;
}

export type XmlNode = XmlTreeElement | XmlTextNode;

const OPEN_TAG_RE = /^<([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^"'>/])*)(\/?)>/;
const CLOSE_TAG_RE = /^<\/\s*([A-Za-z_][\w.:-]*)\s*>/;
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})/;

export function parsePromptTree(src: string): XmlTreeElement {
  const root: XmlTreeElement = { kind: "xml", tag: "#root", children: [], raw: "", selfClosing: false };
  const stack: XmlTreeElement[] = [root];
  let textStart = 0;
  let inFence = false;
  let fenceMarker = "";
  let fenceLen = 0;
  let i = 0;
  const n = src.length;

  const pushText = (end: number) => {
    if (end > textStart) {
      const raw = src.slice(textStart, end);
      if (raw.trim()) {
        stack[stack.length - 1].children.push({ kind: "text", raw });
      }
    }
    textStart = end;
  };

  while (i < n) {
    // ---- markdown fence tracking ----
    const lineStart = i === 0 || src[i - 1] === "\n";
    if (lineStart && !inFence) {
      const m = FENCE_OPEN_RE.exec(src.slice(i, i + 20));
      if (m) {
        inFence = true;
        fenceMarker = m[2][0];
        fenceLen = m[2].length;
      }
    } else if (lineStart && inFence) {
      const re = new RegExp(`^ {0,3}\\${fenceMarker}{${fenceLen},}`);
      if (re.test(src.slice(i, i + 20))) inFence = false;
    }

    if (src[i] !== "<" || inFence) {
      i++;
      continue;
    }

    // ---- handle '<' ----
    const rest = src.slice(i);

    // Close tag
    const closeMatch = CLOSE_TAG_RE.exec(rest);
    if (closeMatch) {
      const tag = closeMatch[1];
      // Find the nearest matching open tag from the top of the stack
      let found = -1;
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === tag) {
          found = s;
          break;
        }
      }
      if (found === -1) {
        i++; // unmatched → plain text
        continue;
      }
      pushText(i);
      // Merge orphan nodes popped between found..top back under their
      // nearest surviving ancestor.
      while (stack.length > found) {
        const node = stack.pop()!;
        if (stack.length >= found) {
          const parent = stack[stack.length - 1];
          if (parent && node !== parent && parent.children.indexOf(node) === -1 && node !== stack[found]) {
            parent.children.push(node);
          }
        }
      }
      i += closeMatch[0].length;
      textStart = i;
      continue;
    }

    // Open tag (with attributes / self-closing)
    const openMatch = OPEN_TAG_RE.exec(rest);
    if (openMatch) {
      pushText(i);
      const node: XmlTreeElement = {
        kind: "xml",
        tag: openMatch[1],
        attrs: openMatch[2].trim() || undefined,
        children: [],
        raw: "",
        selfClosing: openMatch[3] === "/",
      };
      stack[stack.length - 1].children.push(node);
      if (!node.selfClosing) stack.push(node);
      i += openMatch[0].length;
      textStart = i;
      continue;
    }

    // Comment / CDATA / other '<' → text
    i++;
  }
  pushText(n);
  // Unclosed stack nodes stay in place (tolerant)
  return root;
}

/**
 * Recursively collect the total text length of a subtree (used for the
 * top-level chip token estimate).
 */
export function collectSubtreeTextLength(node: XmlNode): number {
  let len = 0;
  for (const c of (node as XmlTreeElement).children || []) {
    if (c.kind === "text") len += c.raw.length;
    else len += collectSubtreeTextLength(c as XmlTreeElement);
  }
  return len;
}

/**
 * Record-node detection: every child is a short-scalar
 * `<tag>text</tag>` (no nesting, no mixed content, single value within
 * a line-heavy budget). These key-value records render as compact
 * field lists rather than a nested tree.
 */
export function isRecordChildren(children: XmlNode[], maxScalarLength = 300): boolean {
  return (
    children.length > 0 &&
    children.every(
      (c) =>
        c.kind === "xml" &&
        (c.children || []).length === 1 &&
        c.children[0].kind === "text" &&
        c.children[0].raw.trim().length <= maxScalarLength,
    )
  );
}
