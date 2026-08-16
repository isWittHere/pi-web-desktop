import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  normalizeFileUri,
  normalizePath,
  dedupeAndSort,
  readClaudeRecents,
  readCodexRecents,
  readVSCodeRecents,
} = await jiti.import("./recent-projects.ts");

test("normalizeFileUri decodes local URIs and rejects remote ones", () => {
  assert.equal(normalizeFileUri("file:///e%3A/Dev/pi-web-main"), "e:/Dev/pi-web-main");
  assert.equal(normalizeFileUri("file:///E:/Dev/x"), "E:/Dev/x");
  assert.equal(normalizeFileUri("file:///home/user/proj"), "home/user/proj");
  assert.equal(normalizeFileUri("vscode-remote://wsl+ubuntu/home/x"), null);
  assert.equal(normalizeFileUri("untitled:Untitled-1"), null);
  assert.equal(normalizeFileUri(""), null);
});

test("normalizePath cleans separators and trailing slashes", () => {
  assert.equal(normalizePath("E:\\Dev\\pi-web-main\\"), "E:/Dev/pi-web-main");
  assert.equal(normalizePath("  /tmp/x/  "), "/tmp/x");
  assert.equal(normalizePath("   "), null);
  assert.equal(normalizePath(""), null);
});

test("dedupeAndSort keeps newest timestamp per path and sinks unknown times", () => {
  const items = [
    { path: "E:/Dev/a", source: "vscode", timeMs: null },
    { path: "E:/Dev/b", source: "zed", timeMs: 200 },
    { path: "e:/dev/a", source: "claude", timeMs: 100 }, // case-insensitive dup
    { path: "E:/Dev/c", source: "codex", timeMs: 300 },
  ];
  const sorted = dedupeAndSort(items);
  assert.deepEqual(sorted.map((p) => p.path), ["E:/Dev/c", "E:/Dev/b", "e:/dev/a"]);
  // The duplicate slot kept the newest timestamp and its source.
  const a = sorted[2];
  assert.equal(a.source, "claude");
  assert.equal(a.timeMs, 100);
});

test("readClaudeRecents parses history.jsonl lines", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-claude-"));
  try {
    const claudeRoot = path.join(dir, ".claude");
    mkdirSync(claudeRoot);
    writeFileSync(path.join(claudeRoot, "history.jsonl"), [
      JSON.stringify({ display: "a", timestamp: 1000, project: "D:\\proj\\one" }),
      JSON.stringify({ display: "b", timestamp: 2000, project: "E:/proj/two" }),
      "garbage line",
    ].join("\n"));
    const recents = await readClaudeRecents(dir);
    assert.equal(recents.length, 2);
    assert.deepEqual(recents.map((r) => r.timeMs), [1000, 2000]);
    assert.equal(recents[0].path, "D:/proj/one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readCodexRecents reads session_meta cwds from the newest files only", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-codex-"));
  try {
    const day = path.join(dir, ".codex", "sessions", "2026", "08", "16");
    mkdirSync(day, { recursive: true });
    const newer = path.join(day, "rollout-2026-08-16T10-00-00-abc.jsonl");
    const older = path.join(day, "rollout-2026-08-15T10-00-00-abc.jsonl");
    writeFileSync(newer, JSON.stringify({
      type: "session_meta",
      payload: { cwd: "E:\\Dev\\newer-proj", timestamp: "2026-08-16T10:00:00.000Z" },
    }) + "\n");
    writeFileSync(older, JSON.stringify({
      type: "session_meta",
      payload: { cwd: "E:\\Dev\\older-proj", timestamp: "2026-08-15T10:00:00.000Z" },
    }) + "\n");
    // Distinct mtimes so the newest-file scan is deterministic.
    const now = Date.now() / 1000;
    utimesSync(newer, now, now);
    utimesSync(older, now - 3600, now - 3600);
    const recents = await readCodexRecents(dir);
    assert.equal(recents.length, 2);
    // Newest file first (sorted by mtime).
    assert.equal(recents[0].path, "E:/Dev/newer-proj");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readVSCodeRecents falls back to storage.json without SQLite", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rp-vscode-"));
  try {
    const userRoot = path.join(dir, "User");
    mkdirSync(path.join(userRoot, "globalStorage"), { recursive: true });
    writeFileSync(path.join(userRoot, "globalStorage", "storage.json"), JSON.stringify({
      openedPathsList: {
        entries: [
          { folderUri: "file:///e%3A/Dev/json-proj" },
          { folderUri: "vscode-remote://wsl+ubuntu/home/x" }, // skipped
        ],
      },
    }));
    const recents = await readVSCodeRecents([userRoot]);
    assert.equal(recents.length, 1);
    assert.equal(recents[0].path, "e:/Dev/json-proj");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readVSCodeRecents returns empty for missing roots", async () => {
  const recents = await readVSCodeRecents([path.join(tmpdir(), "does-not-exist-" + Date.now())]);
  assert.deepEqual(recents, []);
});
