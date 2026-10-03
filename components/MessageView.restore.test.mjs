import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { replaceUserMessageText } = await jiti.import("./MessageView.tsx");

test("replaces the text in a plain string user message", () => {
  const message = { role: "user", content: "old text" };
  assert.deepEqual(replaceUserMessageText(message, "new text"), { role: "user", content: "new text" });
});

test("replaces the first text block and keeps image blocks", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this @src/main.ts" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };
  const out = replaceUserMessageText(message, "/skill:review src/main.ts");
  assert.equal(out.content.length, 2);
  assert.equal(out.content[0].text, "/skill:review src/main.ts");
  assert.deepEqual(out.content[1], message.content[1]);
});

test("preserves non-text blocks in their original order", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
      { type: "text", text: "text one" },
      { type: "text", text: "text two" },
    ],
  };
  const out = replaceUserMessageText(message, "only text");
  assert.deepEqual(
    out.content.map((b) => b.type),
    ["image", "text"],
  );
  assert.equal(out.content[1].text, "only text");
});

test("prepends the text when a message has no text block", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };
  const out = replaceUserMessageText(message, "/skill:review");
  assert.equal(out.content.length, 2);
  assert.equal(out.content[0].text, "/skill:review");
  assert.equal(out.content[1].type, "image");
});

test("the edited message highlights and offers cancel instead of edit", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

  // The edit button no longer navigates on click — it only prefills.
  assert.doesNotMatch(source, /onNavigate/);
  assert.match(source, /onEditContent!\(editTarget, entryId!\)/);
  // Edited message: highlight bubble + cancel button visible without hover.
  assert.match(source, /canCancelEdit = !!isEditing && !!onCancelEdit/);
  assert.match(source, /canEdit && !canCancelEdit/);
  assert.match(source, /onClick=\{onCancelEdit\}/);
  assert.match(source, /color-mix\(in srgb, var\(--accent\) 14%, var\(--user-bg\)\)/);
  // The memo comparator tracks both edit-state props so the highlight updates.
  assert.match(source, /prev\.onCancelEdit === next\.onCancelEdit/);
  assert.match(source, /prev\.isEditing === next\.isEditing/);
});

test("an unanswered length stop offers compaction instead of retrying", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
  const { hasAssistantAnswer } = await import("../lib/message-display.ts");

  // The thinking-only reply is not an answer, so it should compact.
  assert.equal(hasAssistantAnswer({ role: "assistant", content: [{ type: "thinking", thinking: "hm" }] }), false);

  assert.match(source, /unansweredTruncation = message\.stopReason === "length"/);
  assert.match(source, /!hasAssistantAnswer\(message\)/);
  assert.match(source, /t\(isCompacting \? "desktop\.compacting" : "desktop\.compactContext"\)/);
  assert.match(source, /disabled=\{isCompacting\}/);
});
