import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { canRestoreUserMessage, getUserMessageText, getUserMessageDraftImages } = await jiti.import("./ChatInput.tsx");

test("restores text and base64 images when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Review this image @src/example.ts " },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ],
  };

  assert.equal(getUserMessageText(message), "Review this image @src/example.ts ");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("restores legacy flat image entries when editing a user message", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/jpeg" },
    ],
  };

  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/jpeg" },
  ]);
});

test("joins multiple text blocks and ignores non-text blocks", () => {
  const message = {
    role: "user",
    content: [
      { type: "image", data: "AQID", mimeType: "image/png" },
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ],
  };

  assert.equal(getUserMessageText(message), "first\nsecond");
  assert.deepEqual(getUserMessageDraftImages(message), [
    { data: "AQID", mimeType: "image/png" },
  ]);
});

test("plain string content has no draft images", () => {
  assert.equal(getUserMessageText({ role: "user", content: "just text" }), "just text");
  assert.deepEqual(getUserMessageDraftImages({ role: "user", content: "just text" }), []);
});

test("does not restore a historical message over a pending image attachment", () => {
  assert.equal(canRestoreUserMessage("", 0, 0), true);
  assert.equal(canRestoreUserMessage("", 1, 0), false);
  assert.equal(canRestoreUserMessage("", 0, 1), false);
  assert.equal(canRestoreUserMessage("draft", 0, 0), false);
  // Whitespace-only is treated as empty (same as insertIfEmpty semantics).
  assert.equal(canRestoreUserMessage("   ", 0, 0), true);
});

test("filters oversized draft image blocks", () => {
  // A small valid base64 image passes; a >10MB payload is rejected.
  const small = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
  const hugeData = "A".repeat(14 * 1024 * 1024); // ~10.5 MiB decoded > 10 MiB limit
  const huge = { type: "image", source: { type: "base64", media_type: "image/png", data: hugeData } };
  const message = { role: "user", content: [small, huge] };

  const restored = getUserMessageDraftImages(message);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].data, "iVBORw0KGgo=");
});
