import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const displayConfig = await readFile(new URL("./DisplayConfig.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatAppearanceHook = await readFile(new URL("../hooks/useChatAppearance.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { clampChatContentWidth, clampChatContentFontSize } = await jiti.import("../hooks/useChatAppearance.ts");

const widthVariable = /var\(--chat-content-max-width, 820px\)/g;

test("chat content keeps the existing 820px default behind one shared variable", () => {
  assert.equal((chatWindow.match(widthVariable) ?? []).length, 4);
  assert.equal((chatInput.match(widthVariable) ?? []).length, 1);
  assert.match(globals, /--chat-content-max-width: 820px;/);
  assert.match(globals, /max-width: var\(--chat-content-max-width, 820px\)/);
  assert.doesNotMatch(chatWindow, /max-w-\[820px\]|maxWidth: 820/);
  assert.doesNotMatch(chatInput, /maxWidth: 820/);
});

test("the conversation column derives content font size from the shared offset", () => {
  assert.match(chatWindow, /className="chat-content /);
  assert.match(globals, /\.chat-content \{[^}]*--chat-font-size-offset: calc\(var\(--chat-content-font-size, 14px\) - 14px\);/s);
  assert.match(globals, /\.markdown-body \{[^}]*font-size: calc\(14px \+ var\(--chat-font-size-offset, 0px\)\);/s);
  assert.match(globals, /\.markdown-body table \{[^}]*font-size: calc\(13px \+ var\(--chat-font-size-offset, 0px\)\);/s);
  // The composer textarea and its highlight layer must share the variable so
  // the transparent text stays pixel-aligned over the highlight layer.
  assert.match(globals, /\.chat-input-textarea \{[^}]*font-size: var\(--chat-content-font-size, 14px\);/s);
  assert.match(globals, /\.chat-input-highlight \{[^}]*font-size: var\(--chat-content-font-size, 14px\);/s);
  assert.match(chatInput, /useChatAppearance\(\)/);
  assert.match(chatInput, /\[applyAutoHeight, value, fontSize\]/);
});

test("DisplayConfig owns both chat appearance preferences", () => {
  assert.match(displayConfig, /useChatAppearance\(\)/);
  assert.match(displayConfig, /type="range"/);
  assert.match(displayConfig, /min=\{CHAT_CONTENT_WIDTH_MIN\}/);
  assert.match(displayConfig, /max=\{CHAT_CONTENT_WIDTH_MAX\}/);
  assert.match(displayConfig, /step=\{10\}/);
  assert.match(displayConfig, /min=\{CHAT_CONTENT_FONT_SIZE_MIN\}/);
  assert.match(displayConfig, /max=\{CHAT_CONTENT_FONT_SIZE_MAX\}/);
  assert.match(chatAppearanceHook, /pi-chat-content-width/);
  assert.match(chatAppearanceHook, /pi-chat-content-font-size/);
  assert.match(chatAppearanceHook, /localStorage\.setItem/);
});

test("chat width validation preserves the default and supported range", () => {
  assert.equal(clampChatContentWidth(undefined), 820);
  assert.equal(clampChatContentWidth("invalid"), 820);
  assert.equal(clampChatContentWidth(700), 820);
  assert.equal(clampChatContentWidth(1104), 1104);
  assert.equal(clampChatContentWidth(2400), 2000);
});

test("chat font size preserves the default and bounds stored or supplied values", () => {
  for (const value of [undefined, null, "invalid", Infinity, NaN]) {
    assert.equal(clampChatContentFontSize(value), 14);
  }
  assert.equal(clampChatContentFontSize(8), 12);
  assert.equal(clampChatContentFontSize("18"), 18);
  assert.equal(clampChatContentFontSize(18.7), 19);
  assert.equal(clampChatContentFontSize(30), 24);
});
