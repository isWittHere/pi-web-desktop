import assert from "node:assert/strict";
import test from "node:test";

import { resolveSessionModel, sameModel, selectDisplayModel } from "./session-model.ts";

/** Minimal fake ModelRuntime: models present + providers with configured auth. */
function fakeRuntime(models, authedProviders) {
  const authed = new Set(authedProviders);
  return {
    getModel(provider, modelId) {
      return models.find((model) => model.provider === provider && model.id === modelId);
    },
    hasConfiguredAuth(provider) {
      return authed.has(provider);
    },
  };
}

function model(provider, id, extra = {}) {
  return { provider, id, name: id, ...extra };
}

function scope(visible, scopedModels = []) {
  return { visible, scopedModels, thinkingLevelPins: {}, warnings: [] };
}

const CLAUDE = model("anthropic", "claude-x");
const GPT = model("openai", "gpt-x");
const PINNED = model("anthropic", "claude-pinned");

test("recorded model still in scope and authed → active/session", () => {
  const state = resolveSessionModel({
    recorded: { provider: "anthropic", modelId: "claude-x" },
    runtime: fakeRuntime([CLAUDE, GPT], ["anthropic", "openai"]),
    scope: scope([CLAUDE, GPT]),
  });
  assert.deepEqual(state, {
    status: "active",
    model: { provider: "anthropic", modelId: "claude-x" },
    source: "session",
  });
});

test("recorded model deleted → missing/deleted with settings-default suggestion", () => {
  const state = resolveSessionModel({
    recorded: { provider: "acme", modelId: "gone" },
    runtime: fakeRuntime([GPT], ["openai"]),
    scope: scope([GPT]),
    settingsDefault: { provider: "openai", modelId: "gpt-x" },
  });
  assert.deepEqual(state, {
    status: "missing",
    recorded: { provider: "acme", modelId: "gone" },
    reason: "deleted",
    suggestion: { provider: "openai", modelId: "gpt-x" },
  });
});

test("recorded model exists but provider has no auth → missing/no-auth", () => {
  const state = resolveSessionModel({
    recorded: { provider: "openai", modelId: "gpt-x" },
    runtime: fakeRuntime([CLAUDE, GPT], ["anthropic"]),
    scope: scope([CLAUDE, GPT]),
    settingsDefault: { provider: "anthropic", modelId: "claude-x" },
  });
  assert.equal(state.status, "missing");
  assert.equal(state.reason, "no-auth");
  assert.deepEqual(state.suggestion, { provider: "anthropic", modelId: "claude-x" });
});

test("recorded model resolvable but excluded by enabledModels → missing/out-of-scope", () => {
  const state = resolveSessionModel({
    recorded: { provider: "openai", modelId: "gpt-x" },
    runtime: fakeRuntime([CLAUDE, GPT], ["anthropic", "openai"]),
    // enabledModels narrowed the scope to anthropic only
    scope: scope([CLAUDE], [{ model: CLAUDE }]),
    settingsDefault: { provider: "openai", modelId: "gpt-x" },
  });
  assert.equal(state.status, "missing");
  assert.equal(state.reason, "out-of-scope");
  // settings default is out of scope, so the first scoped model wins
  assert.deepEqual(state.suggestion, { provider: "anthropic", modelId: "claude-x" });
});

test("requested model in scope → active/user-request with the scoped thinking pin", () => {
  const state = resolveSessionModel({
    requested: { provider: "anthropic", modelId: "claude-pinned" },
    runtime: fakeRuntime([PINNED], ["anthropic"]),
    scope: scope([PINNED], [{ model: PINNED, thinkingLevel: "high" }]),
  });
  assert.deepEqual(state, {
    status: "active",
    model: { provider: "anthropic", modelId: "claude-pinned" },
    source: "user-request",
    thinkingLevel: "high",
  });
});

test("explicit request wins over the recorded model", () => {
  const state = resolveSessionModel({
    requested: { provider: "openai", modelId: "gpt-x" },
    recorded: { provider: "anthropic", modelId: "claude-x" },
    runtime: fakeRuntime([CLAUDE, GPT], ["anthropic", "openai"]),
    scope: scope([CLAUDE, GPT]),
  });
  assert.equal(state.status, "active");
  assert.equal(state.source, "user-request");
  assert.deepEqual(state.model, { provider: "openai", modelId: "gpt-x" });
});

test("requested model unavailable → missing (caller decides to fail loudly)", () => {
  const state = resolveSessionModel({
    requested: { provider: "acme", modelId: "gone" },
    runtime: fakeRuntime([GPT], ["openai"]),
    scope: scope([GPT]),
    settingsDefault: { provider: "openai", modelId: "gpt-x" },
  });
  assert.equal(state.status, "missing");
  assert.deepEqual(state.recorded, { provider: "acme", modelId: "gone" });
  assert.equal(state.reason, "deleted");
  assert.deepEqual(state.suggestion, { provider: "openai", modelId: "gpt-x" });
});

test("fresh session with no request uses the settings default", () => {
  const state = resolveSessionModel({
    runtime: fakeRuntime([CLAUDE, GPT], ["anthropic", "openai"]),
    scope: scope([CLAUDE, GPT]),
    settingsDefault: { provider: "openai", modelId: "gpt-x" },
  });
  assert.deepEqual(state, {
    status: "active",
    model: { provider: "openai", modelId: "gpt-x" },
    source: "settings-default",
  });
});

test("fresh session without a settings default uses the first scoped model", () => {
  const state = resolveSessionModel({
    runtime: fakeRuntime([CLAUDE, GPT], ["anthropic", "openai"]),
    scope: scope([GPT, CLAUDE], [{ model: GPT }, { model: CLAUDE }]),
  });
  assert.deepEqual(state, {
    status: "active",
    model: { provider: "openai", modelId: "gpt-x" },
    source: "scope-first",
  });
});

test("suggestion priority: settings default first, then scoped, then visible", () => {
  // settings default outside the scope → first scoped model is suggested
  const scopedFirst = resolveSessionModel({
    recorded: { provider: "acme", modelId: "gone" },
    runtime: fakeRuntime([CLAUDE, GPT], ["anthropic", "openai"]),
    scope: scope([CLAUDE], [{ model: CLAUDE }]),
    settingsDefault: { provider: "openai", modelId: "gpt-x" },
  });
  assert.deepEqual(scopedFirst.suggestion, { provider: "anthropic", modelId: "claude-x" });

  // no scope at all → first visible model is suggested
  const visibleFirst = resolveSessionModel({
    recorded: { provider: "acme", modelId: "gone" },
    runtime: fakeRuntime([GPT], ["openai"]),
    scope: scope([GPT]),
  });
  assert.deepEqual(visibleFirst.suggestion, { provider: "openai", modelId: "gpt-x" });
});

test("no models anywhere → missing/none-available with no suggestion", () => {
  const state = resolveSessionModel({
    runtime: fakeRuntime([], []),
    scope: scope([]),
  });
  assert.deepEqual(state, {
    status: "missing",
    recorded: null,
    reason: "none-available",
    suggestion: null,
  });
});

test("sameModel compares provider and id", () => {
  assert.equal(sameModel({ provider: "a", modelId: "m" }, { provider: "a", modelId: "m" }), true);
  assert.equal(sameModel({ provider: "a", modelId: "m" }, { provider: "a", modelId: "n" }), false);
  assert.equal(sameModel({ provider: "a", modelId: "m" }, { provider: "b", modelId: "m" }), false);
});

test("selectDisplayModel priority: override > live > recorded > pending", () => {
  const ref = (p, m) => ({ provider: p, modelId: m });
  assert.deepEqual(
    selectDisplayModel({ override: ref("a", "1"), live: ref("b", "2"), recorded: ref("c", "3"), pending: ref("d", "4") }),
    ref("a", "1"),
  );
  // the live runtime model is authoritative over the recorded file value
  assert.deepEqual(
    selectDisplayModel({ live: ref("b", "2"), recorded: ref("c", "3") }),
    ref("b", "2"),
  );
  assert.deepEqual(selectDisplayModel({ recorded: ref("c", "3"), pending: ref("d", "4") }), ref("c", "3"));
  assert.deepEqual(selectDisplayModel({ pending: ref("d", "4") }), ref("d", "4"));
  assert.equal(selectDisplayModel({}), null);
});
