import assert from "node:assert/strict";
import { parsePromptTree, collectSubtreeTextLength, isRecordChildren } from "./xml-tree.ts";

const parse = (src) => parsePromptTree(src).root;

// --- basic pairing ---
{
  const root = parse("<a><b>text</b></a>");
  assert.equal(root.children.length, 1);
  const a = root.children[0];
  assert.equal(a.kind, "xml");
  assert.equal(a.tag, "a");
  assert.equal(a.children.length, 1);
  const b = a.children[0];
  assert.equal(b.tag, "b");
  assert.equal(b.children.length, 1);
  assert.equal(b.children[0].kind, "text");
  assert.equal(b.children[0].raw, "text");
  console.log("ok: basic pairing");
}

// --- attributes preserved ---
{
  const root = parse('<skills priority="high" mode="auto"><x/></skills>');
  const skills = root.children[0];
  assert.equal(skills.attrs, 'priority="high" mode="auto"');
  assert.equal(skills.children[0].selfClosing, true);
  console.log("ok: attributes + self-closing");
}

// --- unmatched close tag degrades to text ---
{
  const root = parse("hello </orphan> world");
  // '</orphan>' is not a valid tag name pattern start? it is: orphan matches.
  // Unmatched → skipped char-by-char, surrounding text survives.
  const allText = root.children.map((c) => c.raw).join("");
  assert.ok(allText.includes("hello"));
  assert.ok(!root.children.some((c) => c.kind === "xml" && c.tag === "orphan"));
  console.log("ok: unmatched close → text");
}

// --- unclosed tags stay in place (tolerant) ---
{
  const root = parse("<a><b>tail");
  const a = root.children[0];
  assert.equal(a.tag, "a");
  assert.equal(a.children[0].tag, "b");
  assert.equal(a.children[0].children[0].raw, "tail");
  console.log("ok: unclosed tolerated");
}

// --- fenced code block content is NOT parsed as XML ---
{
  const src = "<tools>\nExample:\n\n```xml\n<read path=\"x\"/>\n```\n</tools>";
  const root = parse(src);
  const tools = root.children[0];
  assert.equal(tools.tag, "tools");
  // tools must contain no nested <read> element
  const hasReadChild = tools.children.some((c) => c.kind === "xml" && c.tag === "read");
  assert.equal(hasReadChild, false);
  const text = tools.children.map((c) => c.raw).join("");
  assert.ok(text.includes('<read path="x"/>'));
  console.log("ok: fence-aware");
}

// --- interleaved markdown + xml ---
{
  const src = "Intro text.\n\n<environment>\n<cwd>E:/x</cwd>\n</environment>\n\nTrailing.";
  const root = parse(src);
  assert.equal(root.children.length, 3);
  assert.equal(root.children[0].kind, "text");
  assert.equal(root.children[1].tag, "environment");
  assert.equal(root.children[2].kind, "text");
  const env = root.children[1];
  assert.equal(env.children[0].tag, "cwd");
  assert.equal(env.children[0].children[0].raw, "E:/x");
  console.log("ok: interleaved markdown + xml");
}

// --- duplicate tags render as-is (no dedup) ---
{
  const root = parse("<r><cwd>a</cwd><cwd>b</cwd></r>");
  const r = root.children[0];
  assert.equal(r.children.length, 2);
  assert.equal(r.children[0].children[0].raw, "a");
  assert.equal(r.children[1].children[0].raw, "b");
  console.log("ok: duplicates kept");
}

// --- collectSubtreeTextLength ---
{
  const root = parse("<a>xx<b>yyy</b></a>");
  const a = root.children[0];
  assert.equal(collectSubtreeTextLength(a), 5);
  console.log("ok: collectSubtreeTextLength");
}

// --- isRecordChildren ---
{
  const root = parse(
    "<skill><name>agent-md</name><description>Some long description text.</description><location>C:\\x\\SKILL.md</location></skill>",
  );
  const skill = root.children[0];
  assert.equal(isRecordChildren(skill.children), true);

  // nested children → not a record
  const root2 = parse("<skills><available_skills><skill><name>x</name></skill></available_skills></skills>");
  const skills = root2.children[0];
  assert.equal(isRecordChildren(skills.children), false);

  // empty → not a record
  assert.equal(isRecordChildren([]), false);

  // scalar over budget → not a record
  const long = "y".repeat(301);
  const root3 = parse(`<r><name>${long}</name></r>`);
  assert.equal(isRecordChildren(root3.children[0].children), false);
  console.log("ok: isRecordChildren");
}

// --- realistic system prompt snippet end-to-end ---
{
  const src = [
    "You are pi, a coding assistant.",
    "",
    "<environment>",
    "<cwd>E:/Dev/pi-web-main</cwd>",
    "<platform>win32</platform>",
    "</environment>",
    "",
    "<skills>",
    "<available_skills>",
    "<skill>",
    "<name>agent-md</name>",
    "<description>Analyze project repository.</description>",
    "</skill>",
    "</available_skills>",
    "</skills>",
  ].join("\n");
  const root = parse(src);
  assert.equal(root.children.length, 3);
  const env = root.children[1];
  assert.equal(env.tag, "environment");
  // chain: skills → available_skills → skill (single-xml-child chains parse deep)
  const skills = root.children[2];
  assert.equal(skills.tag, "skills");
  const avail = skills.children[0];
  assert.equal(avail.tag, "available_skills");
  const skill = avail.children[0];
  assert.equal(skill.tag, "skill");
  assert.equal(isRecordChildren(skill.children), true);
  console.log("ok: realistic snippet end-to-end");
}

console.log("xml-tree tests passed");
