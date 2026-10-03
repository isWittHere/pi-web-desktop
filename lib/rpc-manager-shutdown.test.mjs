import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { registerSessionLivenessProvider } = await jiti.import("./session-liveness.ts");

function createInner(calls, { failShutdown = false } = {}) {
  return {
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
        if (failShutdown) throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
}

test("session shutdown notifies extensions before disposing once", async () => {
  const calls = [];
  const wrapper = new AgentSessionWrapper(createInner(calls));
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await Promise.all([wrapper.shutdown(), wrapper.shutdown()]);

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("shutdown disposes the SDK session when an extension hook fails", async () => {
  const calls = [];
  const wrapper = new AgentSessionWrapper(createInner(calls, { failShutdown: true }));
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await assert.rejects(wrapper.shutdown(), /shutdown hook failed/);
  assert.deepEqual(calls.map(([name]) => name), ["emit", "dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

test("direct bash commands use sanitized project operations with current shell settings", async (t) => {
  let received;
  let shellPath = "/bin/bash";
  const inner = {
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: {},
    settingsManager: {
      getShellPath: () => shellPath,
    },
    sessionManager: {
      getCwd: () => process.cwd(),
      getSessionFile: () => undefined,
    },
    agent: { state: {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    executeBash: async (command, _onChunk, options) => {
      received = { command, options };
      return { output: "", exitCode: 0 };
    },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  shellPath = "/custom/bash";
  await wrapper.send({
    type: "bash",
    command: "echo ready",
    excludeFromContext: true,
  });

  assert.equal(received.command, "echo ready");
  assert.equal(received.options.excludeFromContext, true);
  assert.equal(typeof received.options.operations.exec, "function");
});

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// A minimal AgentSessionLike for get_state tests: the prompt is the only field under test.
function makePromptInner() {
  return {
    sessionId: "prompt-session",
    sessionFile: "/tmp/prompt.jsonl",
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    pendingMessageCount: 0,
    model: undefined,
    extensionRunner: {},
    sessionManager: { getCwd: () => "/tmp" },
    // The session-level prompt the SDK renders from its current options.
    systemPrompt: "",
    agent: { state: {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    dispose() {},
  };
}

test("get_state reports the prompt of a session that has not run anything yet", async (t) => {
  // Pi 0.86 replays agent.state.systemPrompt from the transcript, so it is empty until the
  // first run persists a system message. Reporting that empty string made the System panel
  // claim "the prompt is empty (tools are disabled)" on every brand-new session.
  const inner = makePromptInner();
  Object.defineProperty(inner.agent.state, "systemPrompt", {
    get: () => "",
    enumerable: true,
  });
  inner.systemPrompt = "Pi rendered prompt";

  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.systemPrompt, "Pi rendered prompt");
});

test("get_state keeps reporting the replayed prompt once the transcript has one", async (t) => {
  // After a run the session getter falls back to the base options, which no longer carry the
  // sections a before_agent_start handler changed for that run; the transcript still does.
  const inner = makePromptInner();
  Object.defineProperty(inner.agent.state, "systemPrompt", {
    get: () => "base prompt\n\nextension section",
    enumerable: true,
  });
  inner.systemPrompt = "base prompt";

  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.systemPrompt, "base prompt\n\nextension section");
});

test("get_state falls back to replayed state when the session getter is missing", async (t) => {
  const inner = makePromptInner();
  inner.agent.state.systemPrompt = "replayed prompt";

  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.systemPrompt, "replayed prompt");
});

test("get_state keeps an exact prompt ahead of both prompt sources", async (t) => {
  const inner = makePromptInner();
  inner.agent.state.systemPrompt = "replayed prompt";
  inner.systemPrompt = "session prompt";

  const wrapper = new AgentSessionWrapper(inner);
  wrapper.setExactSystemPrompt(() => "exact prompt");
  t.after(() => wrapper.destroy());

  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.systemPrompt, "exact prompt");
});

test("get_tools reports the description the model is actually sent", async (t) => {
  // The definition's description is not always what the model gets: `prepareLoadout` hooks
  // rewrite the declared ones (codemode lists its nested tools and the MCP types).
  const inner = makePromptInner();
  inner.getAllTools = () => [{ name: "codemode", description: "Run JavaScript." }];
  inner.getActiveToolNames = () => ["codemode"];
  inner.agent.state.tools = [{ name: "codemode", description: "Run JavaScript with tools: read, edit." }];

  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const tools = await wrapper.send({ type: "get_tools" });
  assert.equal(tools[0].description, "Run JavaScript with tools: read, edit.");
  assert.equal(tools[0].active, true);
});

test("get_tools falls back to the definition description when nothing was declared", async (t) => {
  const inner = makePromptInner();
  inner.getAllTools = () => [{ name: "read", description: "Read a file." }];
  inner.getActiveToolNames = () => ["read"];

  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());

  const tools = await wrapper.send({ type: "get_tools" });
  assert.equal(tools[0].description, "Read a file.");
});

test("direct destruction emits session_shutdown before dispose when extensions are present", async () => {
  const calls = [];
  const inner = {
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["destroy"]));

  wrapper.destroy();
  wrapper.destroy();

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("direct destruction still disposes when session_shutdown throws synchronously", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls = [];
  const inner = {
    isBashRunning: false,
    extensionRunner: {
      emit() {
        throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner);

  wrapper.destroy();
  await nextTurn();

  assert.deepEqual(calls, ["dispose"]);
  assert.equal(wrapper.isAlive(), false);
});

test("idle timer preserves extension-owned session work until it becomes inactive", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  let active = true;
  const inner = {
    sessionId: "session-1",
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    pendingMessageCount: 0,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    agent: { state: {} },
    subscribe: () => () => {},
    dispose: () => calls.push(["dispose"]),
  };
  const release = registerSessionLivenessProvider({
    name: "test-extension",
    sessionId: "session-1",
    isActive: () => active,
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(release);
  t.after(() => wrapper.destroy());
  wrapper.start();

  t.mock.timers.tick(10 * 60 * 1000);
  await nextTurn();
  assert.equal(wrapper.isAlive(), true);
  assert.deepEqual(calls, []);

  active = false;
  t.mock.timers.tick(10 * 60 * 1000);
  await nextTurn();
  assert.equal(wrapper.isAlive(), false);
  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
  ]);
});

test("idle timer preserves active work but reaps a run stuck after Stop", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  let resolveAbort;
  const inner = {
    sessionId: "session-1",
    isBashRunning: false,
    isStreaming: true,
    isCompacting: false,
    pendingMessageCount: 0,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    agent: { state: {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    subscribe: () => () => {},
    abort: () => {
      calls.push(["abort"]);
      return new Promise((resolve) => { resolveAbort = resolve; });
    },
    dispose: () => calls.push(["dispose"]),
  };
  const release = registerSessionLivenessProvider({
    name: "test-extension",
    sessionId: "session-1",
    isActive: () => true,
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(release);
  t.after(() => wrapper.destroy());
  wrapper.start();

  t.mock.timers.tick(10 * 60 * 1000);
  await nextTurn();
  assert.equal(wrapper.isAlive(), true);
  assert.deepEqual(calls, []);

  const stopping = wrapper.send({ type: "abort" });
  await nextTurn();
  await wrapper.send({ type: "get_state" });
  t.mock.timers.tick(10 * 60 * 1000);
  await nextTurn();

  assert.equal(wrapper.isAlive(), false);
  assert.deepEqual(calls, [
    ["abort"],
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
  ]);

  inner.isStreaming = false;
  resolveAbort();
  await stopping;
});
