import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });

// Execute the component's actual keydown callback without mounting the rest
// of the UI, so queued-send routing can be exercised end to end.
function buildHandler() {
  const source = ts.createSourceFile(
    "ChatInput.tsx",
    readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function findHandler(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleKeyDown") {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findHandler);
  }
  const transpiled = ts.transpileModule(findHandler(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return { script: new Script(transpiled) };
}

const handlerStubs = {
  Date: { now: () => 1000 },
  COMPOSITION_END_ENTER_GRACE_MS: 100,
  isComposingRef: { current: false },
  lastCompositionEndAtRef: { current: 0 },
  isStreaming: true, isMobile: false,
  historyMenuOpen: false, inputHistory: ["previous"], historyActiveIndex: 0,
  setHistoryActiveIndex() {}, setHistoryHoverIndex() {}, setHistoryMenuOpen() {},
  applyHistoryInput() {},
  slashMenuOpen: false, slashQuery: null, filteredSlashCommands: [{}], slashActiveIndex: 0,
  setSlashActiveIndex() {}, setSlashMenuOpen() {}, applySlashCommand() {},
  atMenuOpen: false, atQuery: null, atMatches: [{}], atActiveIndex: 0,
  setAtActiveIndex() {}, setAtMenuOpen() {}, applyAtCompletion() {},
  openAtCompletion() {},
  value: "", setValue() {}, valueRef: { current: "" },
  cwd: "/project", inputShortcut: "enter",
  markdownListContinue: () => null,
  continueMarkdownList: () => null,
  manualMode: false, exitManualHeight() {}, applyAutoHeight() {},
  canQueueStreamingMessage: true,
  textareaRef: { current: null },
  onSteer() {}, onFollowUp() {}, onAbort() {},
  handleSend() {},
};

function makeEvent(overrides = {}) {
  return {
    key: "Enter",
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    nativeEvent: { isComposing: false, keyCode: 13 },
    preventDefault() { this.prevented = true; },
    ...overrides,
  };
}

function runKeydown(context, event) {
  let action = "native";
  const handler = buildHandler().script.runInNewContext({
    ...handlerStubs,
    sendQueued(mode) { action = mode; },
    handleSend() { action = "send"; },
    onAbort() { action = "abort"; },
    applySlashCommand() { action = "slash"; },
    applyAtCompletion() { action = "file"; },
    applyHistoryInput() { action = "history"; },
    openAtCompletion() { action = "file-menu"; },
    ...context,
  });
  const wrapped = {
    ...event,
    preventDefault() {
      event.preventDefault();
      // Mirrors the upstream contract: a swallowed Enter surfaces as "prevented".
      if (action === "native") action = "prevented";
    },
  };
  handler(wrapped);
  return { action, prevented: Boolean(event.prevented) };
}

test("Alt+Enter queues a follow-up while plain Enter keeps steering", () => {
  // Default Enter steers when both handlers exist.
  assert.equal(runKeydown({}, makeEvent()).action, "steer");
  // Alt/Option+Enter queues a follow-up instead.
  assert.equal(runKeydown({}, makeEvent({ altKey: true })).action, "followup");
  // Without a steer handler, plain Enter falls back to follow-up...
  assert.equal(runKeydown({ onSteer: undefined }, makeEvent()).action, "followup");
  // ...and without a follow-up handler, Alt+Enter falls back to steer.
  assert.equal(runKeydown({ onFollowUp: undefined }, makeEvent({ altKey: true })).action, "steer");
  // Idle sessions bypass the queue entirely.
  assert.equal(runKeydown({ isStreaming: false }, makeEvent({ altKey: true })).action, "send");
  // Shift+Enter keeps native newline behavior.
  assert.equal(runKeydown({}, makeEvent({ shiftKey: true })).action, "native");
  // Composition guards still block queued sends.
  assert.equal(runKeydown({ isComposingRef: { current: true } }, makeEvent({ altKey: true })).action, "native");
  assert.equal(runKeydown({ lastCompositionEndAtRef: { current: 950 } }, makeEvent({ altKey: true })).action, "prevented");
  // Menus keep priority over queued sends.
  assert.equal(runKeydown({ slashMenuOpen: true, slashQuery: "help" }, makeEvent({ altKey: true })).action, "slash");
  assert.equal(runKeydown({ atMenuOpen: true, atQuery: {} }, makeEvent({ altKey: true })).action, "file");
});

test("the follow-up button advertises the Alt+Enter shortcut", () => {
  const chatInputSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(chatInputSource, /aria-keyshortcuts="Alt\+Enter"/);
  assert.match(chatInputSource, /Alt\/Option\+Enter/);
});
