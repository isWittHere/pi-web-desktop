import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";

async function loadSubject() {
  return import("./mention-tokens.ts");
}

const INDEX = new Set(["src/chat.tsx", "docs/guide.md", "assets"]);
const SKILLS = new Set(["agent-md", "planning-doc"]);

function validators() {
  return {
    fileExists: (p) => INDEX.has(p) ? true : false,
    isSkill: (n) => SKILLS.has(n) ? true : false,
  };
}

test("highlights valid @file mentions and keeps unknown ones plain", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("check @src/chat.tsx and @missing/file.ts", validators());

  assert.equal(segments.length, 4);
  assert.equal(segments[0].type, "text");
  assert.deepEqual(segments[1], {
    type: "mention",
    text: "@src/chat.tsx",
    token: { kind: "file", value: "src/chat.tsx", valid: true },
  });
  assert.deepEqual(segments[3].token, { kind: "file", value: "missing/file.ts", valid: false });
});

test("quoted mentions are matched only when closed", async () => {
  const { tokenizeMentions } = await loadSubject();
  const closed = tokenizeMentions('see @"docs/guide.md" here', validators());
  assert.equal(closed.filter((s) => s.type === "mention").length, 1);
  assert.equal(closed[1].token.valid, true);
  assert.equal(closed[1].text, '@"docs/guide.md"');

  // Unclosed quote = still being typed → no highlight.
  const open = tokenizeMentions('see @"docs/guide', validators());
  assert.equal(open.filter((s) => s.type === "mention").length, 0);
});

test("directory mentions with trailing slash are validated against dirs", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("@assets/", validators());
  assert.equal(segments[0].type, "mention");
  assert.equal(segments[0].token.valid, true);
  assert.equal(segments[0].token.value, "assets");
});

test("@ inside words and emails never matches", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("foo@bar.com and a@b", validators());
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "text");
});

test("valid /skill: tokens highlight, unknown ones stay plain", async () => {
  const { tokenizeMentions } = await loadSubject();
  const good = tokenizeMentions("/skill:agent-md write a plan", validators());
  assert.deepEqual(good[0], {
    type: "mention",
    text: "/skill:agent-md",
    token: { kind: "skill", value: "agent-md", valid: true },
  });

  const bad = tokenizeMentions("/skill:unknown-skill x", validators());
  assert.equal(bad[0].type, "mention");
  assert.equal(bad[0].token.valid, false);
});

test("unknown validator state (not loaded) never validates", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("@src/chat.tsx", {});
  assert.equal(segments[0].type, "mention");
  assert.equal(segments[0].token.valid, false);
});

test("the token under the active @ query caret stays plain", async () => {
  const { tokenizeMentions } = await loadSubject();
  // The autocomplete query starts at the "@" (index 0).
  const segments = tokenizeMentions("@src/chat.tsx done", validators(), 0);
  assert.equal(segments[0].type, "text");
  assert.equal(segments[0].text, "@src/chat.tsx");
  assert.equal(segments[1].type, "text");
});

test("mentions at line starts and after whitespace are found", async () => {
  const { tokenizeMentions } = await loadSubject();
  const segments = tokenizeMentions("a\n@src/chat.tsx\nb @docs/guide.md", validators());
  const mentions = segments.filter((s) => s.type === "mention");
  assert.equal(mentions.length, 2);
  assert.ok(mentions.every((m) => m.token.valid));
});

test("buildMentionHtml escapes path and token text", async () => {
  const { buildMentionHtml } = await loadSubject();
  const html = buildMentionHtml({
    type: "mention",
    text: '@"a&b <c>.md"',
    token: { kind: "file", value: "a&b <c>.md", valid: true },
  });
  assert.equal(
    html,
    '<span class="mention-token mention-token-file" data-mention-kind="file" data-mention-value="a&amp;b &lt;c&gt;.md">@&quot;a&amp;b &lt;c&gt;.md&quot;</span>',
  );
});

// ── remark plugin (mentionRemarkPlugin) ────────────────────────────────────
// The plugin ships in the same module (mention-tokens.ts); drive it through a
// real unified pipeline so parsing semantics (code blocks, inline code,
// emphasis) are exercised, not just the tree transformer.

async function runPlugin(markdown, pluginValidators) {
  const { mentionRemarkPlugin } = await loadSubject();
  const processor = unified().use(remarkParse).use(mentionRemarkPlugin(pluginValidators));
  return processor.runSync(processor.parse(markdown));
}

test("plugin wraps valid mentions in html spans, leaves invalid as text", async () => {
  const tree = await runPlugin("see @src/chat.tsx and @nope.ts", {
    fileExists: (p) => (p === "src/chat.tsx" ? true : false),
  });
  const children = tree.children[0].children;
  assert.deepEqual(children.map((c) => c.type), ["text", "html", "text", "text"]);
  assert.equal(children[1].value, '<span class="mention-token mention-token-file" data-mention-kind="file" data-mention-value="src/chat.tsx">@src/chat.tsx</span>');
  assert.equal(children[2].value, " and ");
  assert.equal(children[3].value, "@nope.ts");
});

test("plugin leaves code blocks untouched", async () => {
  const tree = await runPlugin("```\n@src/chat.tsx\n```", {
    fileExists: () => true,
  });
  // The fenced code is a code node, not a text node — nothing to split.
  assert.equal(tree.children[0].type, "code");
  assert.equal(tree.children[0].value, "@src/chat.tsx");
});

test("plugin leaves inline code spans untouched", async () => {
  const tree = await runPlugin("use `@src/chat.tsx` inline", {
    fileExists: () => true,
  });
  const inline = tree.children[0].children.find((c) => c.type === "inlineCode");
  assert.ok(inline);
  assert.equal(inline.value, "@src/chat.tsx");
});

test("plugin splits only the text node that contains the mention", async () => {
  const tree = await runPlugin("**bold @src/chat.tsx end**", {
    fileExists: () => true,
  });
  const strong = tree.children[0].children[0];
  assert.equal(strong.type, "strong");
  const parts = strong.children.map((c) => c.type);
  assert.deepEqual(parts, ["text", "html", "text"]);
  assert.equal(strong.children[1].value.includes('class="mention-token'), true);
});

test("plugin renders valid skill tokens as spans, unknown skills plain", async () => {
  const tree = await runPlugin("/skill:agent-md write a plan", {
    isSkill: (n) => (n === "agent-md" ? true : false),
  });
  const children = tree.children[0].children;
  assert.deepEqual(children.map((c) => c.type), ["html", "text"]);
  assert.equal(children[0].value.includes("mention-token-skill"), true);
  assert.equal(children[1].value, " write a plan");
});
