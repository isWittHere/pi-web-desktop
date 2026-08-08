import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./skill-block.ts");
}

test("parses a full SDK-expanded skill block with args", async () => {
  const { parseSkillBlock } = await loadSubject();
  const text = `<skill name="agent-md" location="C:/Users/me/.agents/skills/agent-md/SKILL.md">\nReferences are relative to C:/Users/me/.agents/skills/agent-md.\n\n# Agent MD\n\nInstructions.\n</skill>\n\n请帮我写计划`;

  const block = parseSkillBlock(text);
  assert.ok(block);
  assert.equal(block.name, "agent-md");
  assert.equal(block.location, "C:/Users/me/.agents/skills/agent-md/SKILL.md");
  // The SDK embeds the "References are relative to" line inside the block,
  // so it is part of the raw body.
  assert.equal(
    block.body,
    "References are relative to C:/Users/me/.agents/skills/agent-md.\n\n# Agent MD\n\nInstructions.",
  );
  assert.equal(block.args, "请帮我写计划");
});

test("parses a skill block without args", async () => {
  const { parseSkillBlock } = await loadSubject();
  const text = `<skill name="compact" location="/home/u/.agents/skills/compact/SKILL.md">\nReferences are relative to /home/u/.agents/skills/compact.\n\nBody here.\n</skill>`;

  const block = parseSkillBlock(text);
  assert.ok(block);
  assert.equal(block.name, "compact");
  assert.equal(block.args, "");
});

test("returns null for plain messages", async () => {
  const { parseSkillBlock } = await loadSubject();
  assert.equal(parseSkillBlock("hello world"), null);
  assert.equal(parseSkillBlock(""), null);
  assert.equal(parseSkillBlock("/skill:compact still raw text"), null);
});

test("returns null for malformed blocks", async () => {
  const { parseSkillBlock } = await loadSubject();
  assert.equal(parseSkillBlock('<skill name="x" location="y">\nno close tag'), null);
  assert.equal(parseSkillBlock('<skill name="x">\nbody\n</skill>'), null);
  // Leading text before the block is not the SDK format → render raw.
  assert.equal(parseSkillBlock('prefix\n<skill name="x" location="y">\nbody\n</skill>'), null);
});

test("getSessionDisplayFirstMessage collapses a skill block to its command", async () => {
  const { getSessionDisplayFirstMessage } = await loadSubject();
  const withArgs = `<skill name="agent-md" location="C:/Users/me/.agents/skills/agent-md/SKILL.md">\nReferences are relative to C:/Users/me/.agents/skills/agent-md.\n\n# Agent MD\n\nInstructions.\n</skill>\n\n写计划`;
  assert.equal(getSessionDisplayFirstMessage(withArgs), "/skill:agent-md 写计划");

  const noArgs = `<skill name="compact" location="/home/u/.agents/skills/compact/SKILL.md">\nReferences are relative to /home/u/.agents/skills/compact.\n\nBody here.\n</skill>`;
  assert.equal(getSessionDisplayFirstMessage(noArgs), "/skill:compact");
});

test("getSessionDisplayFirstMessage passes plain and non-block text through", async () => {
  const { getSessionDisplayFirstMessage } = await loadSubject();
  assert.equal(getSessionDisplayFirstMessage("hello world"), "hello world");
  assert.equal(getSessionDisplayFirstMessage("/skill:compact still raw text"), "/skill:compact still raw text");
  assert.equal(getSessionDisplayFirstMessage(""), "");
});
