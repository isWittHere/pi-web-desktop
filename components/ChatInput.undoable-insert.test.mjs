import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { replaceTextareaRange } = await jiti.import("./ChatInput.tsx");

// A minimal textarea that records the native edits, the way a browser would.
function fakeTextarea(value, caret) {
  const calls = [];
  const textarea = {
    value,
    selectionStart: caret,
    selectionEnd: caret,
    focus() { calls.push(["focus"]); },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
      calls.push(["selection", start, end]);
    },
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
      calls.push(["setRangeText", text, start, end]);
    },
    dispatchEvent(event) { calls.push(["dispatch", event.type]); },
  };
  globalThis.document = {
    execCommand(command, _showUi, text = "") {
      calls.push(["command", command, text]);
      if (command === "delete") {
        textarea.value = textarea.value.slice(0, --textarea.selectionStart) + textarea.value.slice(textarea.selectionEnd);
        textarea.selectionEnd = textarea.selectionStart;
      } else if (command === "insertText") {
        textarea.value = textarea.value.slice(0, textarea.selectionStart) + text + textarea.value.slice(textarea.selectionEnd);
        textarea.selectionStart += text.length;
        textarea.selectionEnd = textarea.selectionStart;
      } else if (command === "forwardDelete") {
        textarea.value = textarea.value.slice(0, textarea.selectionStart) + textarea.value.slice(textarea.selectionStart + 1);
      }
      return true;
    },
  };
  return { textarea, calls };
}

test("file mention insertion uses one native undoable edit", () => {
  const { textarea, calls } = fakeTextarea('@"my/"', 6);
  // A quoted path keeps the caret before its closing quote, hence the offset.
  replaceTextareaRange(textarea, 0, 6, '@"my dir/"', 9);
  assert.equal(textarea.value, '@"my dir/"');
  assert.equal(textarea.selectionStart, 9);
  assert.deepEqual(calls, [
    ["focus"],
    // The typed prefix is deleted one character at a time, so the browser's own
    // undo stack records each step rather than one scripted value assignment.
    ...Array.from({ length: 6 }, () => ["command", "delete", ""]),
    ["command", "insertText", '@"my dir/"'],
    ["selection", 9, 9],
  ]);
});

test("a selection spanning the range is replaced in one insertText", () => {
  const { textarea, calls } = fakeTextarea('@"old/"', 2);
  textarea.selectionEnd = 7;
  replaceTextareaRange(textarea, 0, 7, '@"new/"', 6);
  assert.equal(textarea.value, '@"new/"');
  assert.equal(textarea.selectionStart, 6);
  assert.deepEqual(calls, [
    ["focus"],
    ["selection", 0, 7],
    ["command", "insertText", '@"new/"'],
    ["selection", 6, 6],
  ]);
});

test("the tail after a collapsed caret is forward-deleted, not left behind", () => {
  // @"my/" + a stray closing quote the caret sits before.
  const { textarea } = fakeTextarea('@"my/""', 6);
  replaceTextareaRange(textarea, 0, 7, '@"my dir/"', 9);
  assert.equal(textarea.value, '@"my dir/"');
});

test("a refused execCommand still lands the text and fires React's onChange", () => {
  const { textarea, calls } = fakeTextarea("hello", 5);
  globalThis.document.execCommand = () => false;
  replaceTextareaRange(textarea, 0, 5, "goodbye");
  assert.equal(textarea.value, "goodbye");
  // No undo entry, but the input event reaches the controlled component.
  assert.ok(calls.some(([kind]) => kind === "setRangeText"));
  assert.ok(calls.some(([kind, type]) => kind === "dispatch" && type === "input"));
});

test("the caret is only moved when the caller asks for an offset", () => {
  const { textarea } = fakeTextarea("ab", 2);
  replaceTextareaRange(textarea, 0, 2, "abcd");
  // Default: the end of the inserted text.
  assert.equal(textarea.selectionStart, 4);
  const second = fakeTextarea("ab", 2);
  replaceTextareaRange(second.textarea, 0, 2, "abcd", 2);
  assert.equal(second.textarea.selectionStart, 2);
});

test("both composer insertion paths go through the native edit", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  // insertText (the handle) and the @-menu completion.
  assert.equal((source.match(/replaceTextareaRange\(/g) ?? []).length, 3);
  assert.doesNotMatch(source, /const newVal = before \+ sep \+ text \+ after;/);
  assert.doesNotMatch(source, /const newValue = before \+ insert\.text \+ after;/);
});
