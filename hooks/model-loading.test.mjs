import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

// Extract the model-load retry effect from useAgentSession.ts and execute it
// against a stubbed loadModels, so the bounded-retry and abort contract is
// locked without mounting React.
const source = ts.createSourceFile(
  "useAgentSession.ts",
  await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
const schedule = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "MODELS_RETRY_DELAYS_MS");
const effect = nodes.find((node) => ts.isCallExpression(node)
  && node.expression.getText(source) === "useEffect"
  && node.arguments[1]?.getText(source) === "[loadModels, modelsRefreshKey]");
const retry = effect.arguments[0].body.statements.find(ts.isExpressionStatement).expression;
function script(text) {
  return new Script(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}
const retryDelayTable = script(schedule.initializer.getText(source)).runInNewContext();

function setup(loadModels) {
  const calls = [];
  const delays = [];
  const context = {
    Error, DOMException,
    controller: new AbortController(),
    loadModels: async (...args) => {
      calls.push(args);
      return loadModels(...args);
    },
    MODELS_RETRY_DELAYS_MS: retryDelayTable,
    delay: async (ms) => { delays.push(ms); },
  };
  context.run = () => retryScript.runInNewContext(context);
  // Strip the `void` so the script evaluates to the loop's promise and `run`
  // can be awaited through the full retry sequence.
  const retryScript = script(`(${retry.getText(source).replace(/^void\s*/, "")})`);
  return { context, calls, delays, run: () => retryScript.runInNewContext(context) };
}

test("model-load failures retry with bounded backoff", async () => {
  let attempts = 0;
  const state = setup(async () => {
    attempts++;
    throw new TypeError("Failed to fetch");
  });
  await state.run();
  assert.equal(attempts, retryDelayTable.length + 1);
  assert.deepEqual(state.delays, [...retryDelayTable]);
});

test("a recovered attempt stops the retry loop", async () => {
  let attempts = 0;
  const state = setup(async () => {
    if (++attempts === 1) throw new TypeError("Failed to fetch");
  });
  await state.run();
  assert.equal(attempts, 2);
  assert.deepEqual(state.delays, [retryDelayTable[0]]);
});

test("aborting cancels retries without further delays", async () => {
  let attempts = 0;
  const state = setup(async () => {
    attempts++;
    throw new TypeError("Failed to fetch");
  });
  state.context.delay = async () => state.context.controller.abort();
  await state.run();
  // The abort fires inside the first backoff delay, so only the initial
  // attempt runs and no further delays are scheduled.
  assert.equal(attempts, 1);
  assert.deepEqual(state.delays, []);
});

test("an AbortError from loadModels stops the loop immediately", async () => {
  const abort = new DOMException("aborted", "AbortError");
  const state = setup(async () => {
    throw abort;
  });
  await state.run();
  assert.deepEqual(state.delays, []);
});
