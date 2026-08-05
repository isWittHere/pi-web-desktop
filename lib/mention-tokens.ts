// Tokenization shared by the chat input's highlight overlay and the rendered
// user-message bodies: @file mentions and /skill: commands are marked with
// accent + dotted underline styling, but only when they resolve to something
// real (a file/dir in the project index, a loaded skill). Unknown or
// in-progress tokens stay plain text.

import type { Root } from "mdast";

export type MentionKind = "file" | "skill";

export interface MentionValidators {
  /**
   * True when the cwd-relative path exists in the project index. Return
   * undefined when the index has not been loaded yet (treated as invalid
   * until data arrives — highlighting must never guess).
   */
  fileExists?: (path: string) => boolean | undefined;
  /** True when the skill name is loaded. Undefined = unknown (same rule). */
  isSkill?: (name: string) => boolean | undefined;
}

export interface MentionToken {
  kind: MentionKind;
  /** Normalized value: unquoted path (trailing "/" stripped) or skill name */
  value: string;
  valid: boolean;
}

export interface MentionSegment {
  type: "mention";
  /** Raw token text exactly as typed (@"quoted" form kept intact) */
  text: string;
  token: MentionToken;
}

export interface TextSegment {
  type: "text";
  text: string;
}

export type InputSegment = TextSegment | MentionSegment;

/**
 * @ triggers only at line start or after whitespace — the same boundary rule
 * as the TUI autocomplete, so emails (foo@bar.com) never match. The quoted
 * form must be closed ("@\"my dir/file\"") — an unclosed quote means the
 * token is still being typed. /skill: needs the same boundary; the name runs
 * to the next whitespace.
 */
const MENTION_RE = /(?<=^|[\s\u00A0])(@"[^"\n]*"|@[^\s"]+|\/skill:[^\s]+)/g;

function stripFileToken(raw: string): string {
  if (raw.startsWith('@"') && raw.endsWith('"')) return raw.slice(2, -1);
  return raw.slice(1);
}

function classifyToken(raw: string, validators: MentionValidators): MentionToken {
  if (raw.startsWith("/skill:")) {
    const name = raw.slice("/skill:".length);
    return {
      kind: "skill",
      value: name,
      valid: validators.isSkill?.(name) === true,
    };
  }
  const value = stripFileToken(raw).replace(/\/+$/, "");
  return {
    kind: "file",
    value,
    valid: validators.fileExists?.(value) === true,
  };
}

/**
 * Split text into plain and mention segments. `activeTokenStart` marks the
 * @ token currently being edited (from the autocomplete query state); the
 * token under the caret is kept plain so partial input never flashes styled
 * while the user is still typing inside it.
 */
export function tokenizeMentions(
  text: string,
  validators: MentionValidators,
  activeTokenStart: number | null = null,
): InputSegment[] {
  const segments: InputSegment[] = [];
  let lastIndex = 0;
  MENTION_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;

    if (start > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, start) });
    }
    if (activeTokenStart !== null && start === activeTokenStart) {
      // In-progress autocomplete token: keep it (and its raw text) plain.
      segments.push({ type: "text", text: raw });
    } else {
      segments.push({ type: "mention", text: raw, token: classifyToken(raw, validators) });
    }
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }
  return segments;
}

/**
 * Build the inline HTML emitted by the markdown mention plugin for one valid
 * mention. Escaping is required: the path/skill name travels through
 * rehype-raw (the raw HTML pipeline) before rehype-sanitize.
 */
export function buildMentionHtml(segment: MentionSegment): string {
  const escapedText = escapeHtml(segment.text);
  const escapedValue = escapeHtml(segment.token.value);
  return `<span class="mention-token mention-token-${segment.token.kind}" data-mention-kind="${segment.token.kind}" data-mention-value="${escapedValue}">${escapedText}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── remark plugin for rendered markdown ────────────────────────────────────
// Marks valid @file / /skill: mentions inside markdown text. Works at the AST
// level so mentions inside code blocks (code / inlineCode nodes) are never
// touched, and mention tokens that happen to span markdown constructs split
// only their own text node. Valid mentions become inline html
// (<span class="mention-token">) which the rehype-raw + rehype-sanitize
// pipeline renders as styled tokens; invalid or unknown ones stay plain text.

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

function walkTextNodes(node: MdNode, transform: (value: string) => MdNode[] | null): void {
  const children = node.children;
  if (!children) return;
  const next: MdNode[] = [];
  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      const replaced = transform(child.value);
      if (replaced) {
        // Inserted nodes are our own html/text leaves or untouched children;
        // keep the walk uniform so nested nodes are still visited.
        for (const item of replaced) {
          if (item.children) walkTextNodes(item, transform);
          next.push(item);
        }
        continue;
      }
    }
    walkTextNodes(child, transform);
    next.push(child);
  }
  node.children = next;
}

export function mentionRemarkPlugin(validators: MentionValidators) {
  return () => (tree: Root) => {
    walkTextNodes(tree as unknown as MdNode, (value) => {
      const segments = tokenizeMentions(value, validators);
      if (segments.length === 1 && segments[0].type === "text") return null;
      const nodes: MdNode[] = [];
      for (const segment of segments) {
        if (segment.type === "text") {
          nodes.push({ type: "text", value: segment.text });
        } else if (segment.token.valid) {
          nodes.push({ type: "html", value: buildMentionHtml(segment) });
        } else {
          nodes.push({ type: "text", value: segment.text });
        }
      }
      return nodes;
    });
  };
}
