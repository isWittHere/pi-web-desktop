// Parsing of SDK-expanded skill blocks in stored user messages.
//
// When the user sends `/skill:name args`, the pi SDK replaces the raw text
// with the skill's full content before the message is stored in the session
// file:
//
//   <skill name="..." location="...">
//   References are relative to ....
//
//   <skill body>
//   </skill>
//
//   args
//
// That expanded form is what the UI reads back, so instead of showing the
// raw skill source the message renderer collapses it to a styled token. The
// regex below mirrors the SDK's own matcher in agent-session.js so any block
// the SDK writes is recognized.

export interface SkillBlock {
  name: string;
  location: string;
  /** Raw skill file body (frontmatter stripped by the SDK) */
  body: string;
  /** Text the user typed after the skill name (may be empty) */
  args: string;
}

const SKILL_BLOCK_RE =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

export function parseSkillBlock(text: string): SkillBlock | null {
  const match = SKILL_BLOCK_RE.exec(text);
  if (!match) return null;
  return {
    name: match[1],
    location: match[2],
    body: match[3],
    args: (match[4] ?? "").trim(),
  };
}

/**
 * Derive a concise display form of a stored first user message for session
 * auto-naming. When the message is an SDK-expanded skill block, collapse it to
 * the compact `/skill:name args` command the user actually typed (mirroring
 * MessageView's edit reconstruction) instead of leaking the raw `<skill>` XML
 * into the session title. Plain messages pass through untouched.
 */
export function getSessionDisplayFirstMessage(text: string): string {
  const block = parseSkillBlock(text);
  return block
    ? `/skill:${block.name}${block.args ? ` ${block.args}` : ""}`
    : text;
}
