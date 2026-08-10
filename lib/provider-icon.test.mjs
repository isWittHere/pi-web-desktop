import test from "node:test";
import assert from "node:assert/strict";
import {
  API_TYPE_BADGES,
  parseProviderIconMode,
  resolveApiBadge,
  resolveProviderIconSource,
  resolveProviderLetter,
} from "./provider-icon.ts";

test("resolveApiBadge maps known API types", () => {
  assert.equal(resolveApiBadge("openai-completions"), "C");
  assert.equal(resolveApiBadge("openai-responses"), "R");
  assert.equal(resolveApiBadge("openai-codex-responses"), "X");
  assert.equal(resolveApiBadge("azure-openai-responses"), "R");
  assert.equal(resolveApiBadge("anthropic-messages"), "M");
  assert.equal(resolveApiBadge("google-generative-ai"), "G");
  assert.equal(resolveApiBadge("google-vertex"), "G");
  assert.equal(resolveApiBadge("mistral-conversations"), "M");
  assert.equal(resolveApiBadge("bedrock-converse-stream"), "B");
  assert.equal(resolveApiBadge("pi-messages"), "P");
});

test("resolveApiBadge returns null for unknown or missing API types", () => {
  assert.equal(resolveApiBadge("ollama"), null);
  assert.equal(resolveApiBadge(""), null);
  assert.equal(resolveApiBadge(null), null);
  assert.equal(resolveApiBadge(undefined), null);
});

test("API_TYPE_BADGES covers every known badge letter expectation", () => {
  assert.equal(Object.keys(API_TYPE_BADGES).length, 10);
});

test("resolveProviderLetter extracts the first alphanumeric character", () => {
  assert.equal(resolveProviderLetter("zai-coding-cn"), "Z");
  assert.equal(resolveProviderLetter("deepseek"), "D");
  assert.equal(resolveProviderLetter("123abc"), "1");
  assert.equal(resolveProviderLetter("moonshotai-cn"), "M");
  assert.equal(resolveProviderLetter("_custom"), "C");
  assert.equal(resolveProviderLetter("-x"), "X");
  assert.equal(resolveProviderLetter(""), "?");
  assert.equal(resolveProviderLetter("   "), "?");
  assert.equal(resolveProviderLetter("???!!"), "?");
});

test("parseProviderIconMode accepts only api/letter and defaults to auto", () => {
  assert.equal(parseProviderIconMode("api"), "api");
  assert.equal(parseProviderIconMode("letter"), "letter");
  assert.equal(parseProviderIconMode("auto"), "auto");
  assert.equal(parseProviderIconMode("logo"), "auto");
  assert.equal(parseProviderIconMode(""), "auto");
  assert.equal(parseProviderIconMode(null), "auto");
  assert.equal(parseProviderIconMode(undefined), "auto");
  assert.equal(parseProviderIconMode(42), "auto");
});

test("resolveProviderIconSource auto mode: preset providers keep a plain logo", () => {
  // Preset providers render their logo without any corner badge.
  assert.deepEqual(resolveProviderIconSource("deepseek", "openai-completions", "auto", true), {
    type: "provider-logo",
  });
  assert.deepEqual(resolveProviderIconSource("deepseek", "ollama", "auto", true), {
    type: "provider-logo",
  });
  assert.deepEqual(resolveProviderIconSource("deepseek", null, "auto", true), {
    type: "provider-logo",
  });
});

test("resolveProviderIconSource auto mode falls back to API representative logo", () => {
  assert.deepEqual(resolveProviderIconSource("my-proxy", "openai-completions", "auto", false), {
    type: "api-logo",
    api: "openai-completions",
    badge: "C",
  });
  // Unknown provider + unknown API → CPU.
  assert.deepEqual(resolveProviderIconSource("my-proxy", "ollama", "auto", false), {
    type: "cpu",
  });
  // Unknown provider + no API → CPU.
  assert.deepEqual(resolveProviderIconSource("my-proxy", undefined, "auto", false), {
    type: "cpu",
  });
});

test("resolveProviderIconSource api mode forces the representative logo", () => {
  assert.deepEqual(resolveProviderIconSource("deepseek", "anthropic-messages", "api", true), {
    type: "api-logo",
    api: "anthropic-messages",
    badge: "M",
  });
  // Unknown API type in api mode: preset logo is kept instead of CPU.
  assert.deepEqual(resolveProviderIconSource("deepseek", "ollama", "api", true), {
    type: "provider-logo",
  });
  // Unknown API type and no preset logo → CPU.
  assert.deepEqual(resolveProviderIconSource("my-proxy", "ollama", "api", false), {
    type: "cpu",
  });
});

test("resolveProviderIconSource letter mode ignores logo and API", () => {
  assert.deepEqual(resolveProviderIconSource("deepseek", "openai-completions", "letter", true), {
    type: "letter",
    letter: "D",
  });
  assert.deepEqual(resolveProviderIconSource("zai-coding-cn", null, "letter", false), {
    type: "letter",
    letter: "Z",
  });
});
