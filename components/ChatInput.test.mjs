import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

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
  isStreaming: true,
  historyMenuOpen: false, inputHistory: ["previous"], historyActiveIndex: 0,
  setHistoryActiveIndex() {}, setHistoryHoverIndex() {}, setHistoryMenuOpen() {},
  slashMenuOpen: false, slashQuery: null, filteredSlashCommands: [{}], slashActiveIndex: 0,
  setSlashActiveIndex() {}, setSlashMenuOpen() {},
  atMenuOpen: false, atQuery: null, atItems: [{}], atActiveIndex: 0,
  setAtActiveIndex() {}, setAtMenuOpen() {},
  value: "", setValue() {},
  cwd: "/project", inputShortcut: "enter",
  markdownListContinue: () => null,
  continueMarkdownList: () => null,
  applyAutoHeight() {},
  textareaRef: { current: null },
  onSteer() {}, onFollowUp() {},
};

function makeEvent(overrides = {}) {
  return {
    key: "Enter",
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    nativeEvent: { isComposing: false, keyCode: 13 },
    preventDefault() {},
    ...overrides,
  };
}

function runKeydown(context, event) {
  let action = "native";
  const handler = buildHandler().script.runInNewContext({
    ...handlerStubs,
    sendQueued(mode) { action = mode; },
    handleSend() { action = "send"; },
    applySlashCommand() { action = "slash"; },
    applyAtCompletion() { action = "file"; },
    ...context,
  });
  handler({
    ...event,
    preventDefault() {
      event.preventDefault();
      // Mirrors the upstream contract: a swallowed Enter surfaces as "prevented".
      if (action === "native") action = "prevented";
    },
  });
  return action;
}

test("Alt+Enter queues a follow-up while plain Enter keeps steering", () => {
  // Default Enter steers when both handlers exist.
  assert.equal(runKeydown({}, makeEvent()), "steer");
  // Alt/Option+Enter queues a follow-up instead.
  assert.equal(runKeydown({}, makeEvent({ altKey: true })), "followup");
  // Without a steer handler, plain Enter falls back to follow-up...
  assert.equal(runKeydown({ onSteer: undefined }, makeEvent()), "followup");
  // ...and without a follow-up handler, Alt+Enter falls back to steer.
  assert.equal(runKeydown({ onFollowUp: undefined }, makeEvent({ altKey: true })), "steer");
  // Idle sessions bypass the queue entirely.
  assert.equal(runKeydown({ isStreaming: false }, makeEvent({ altKey: true })), "send");
  // Shift+Enter keeps native newline behavior.
  assert.equal(runKeydown({}, makeEvent({ shiftKey: true })), "native");
  // Composition guards still block queued sends.
  assert.equal(runKeydown({ isComposingRef: { current: true } }, makeEvent({ altKey: true })), "native");
  assert.equal(runKeydown({ lastCompositionEndAtRef: { current: 950 } }, makeEvent({ altKey: true })), "prevented");
  // Menus keep priority over queued sends.
  assert.equal(runKeydown({ slashMenuOpen: true, slashQuery: "help" }, makeEvent({ altKey: true })), "slash");
  assert.equal(runKeydown({ atMenuOpen: true, atQuery: {} }, makeEvent({ altKey: true })), "file");
});

test("the follow-up button advertises the Alt+Enter shortcut", () => {
  const chatInputSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(chatInputSource, /aria-keyshortcuts="Alt\+Enter"/);
  assert.match(chatInputSource, /Alt\/Option\+Enter/);
});
