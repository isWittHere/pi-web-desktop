import assert from "node:assert/strict";
import test from "node:test";

import { formatRelativeTime, interpolateMessage, translateMessage } from "./format.ts";

test("interpolates string and numeric parameters", () => {
  assert.equal(interpolateMessage("Hello, {name} ({count})", { name: "Pi", count: 2 }), "Hello, Pi (2)");
  assert.equal(interpolateMessage("Missing {name}"), "Missing {name}");
});

test("falls back to English and returns the key when both catalogs are missing it", () => {
  const messages = { en: { ok: "OK" }, "zh-CN": {} };
  assert.equal(translateMessage("zh-CN", "ok", messages), "OK");
  assert.equal(translateMessage("zh-CN", "missing", messages), "missing");
});

test("formats relative time using the selected locale", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(formatRelativeTime(new Date("2026-01-01T00:05:00.000Z"), "en", now), "in 5 minutes");
  assert.equal(formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), "zh-CN", now), "1小时前");
});
