import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveDraftTarget, resolveRestoreTarget } = await jiti.import("./workspace-restore.ts");

const S = (id, projectKey, modified) => ({
  // Minimal SessionInfo shape; the resolver only reads id/projectRoot/cwd/modified.
  path: `${projectKey}/${id}`,
  id,
  cwd: projectKey,
  projectRoot: projectKey,
  created: modified,
  modified,
  messageCount: 1,
  firstMessage: "",
});

test("resolveDraftTarget reopens the remembered draft", () => {
  const target = resolveDraftTarget({ kind: "draft", id: "d1" }, [{ id: "d1", cwd: "E:/Dev/a" }]);
  assert.deepEqual(target, { kind: "draft", draft: { id: "d1", cwd: "E:/Dev/a" } });
});

test("resolveDraftTarget returns null for stale or absent drafts", () => {
  assert.equal(resolveDraftTarget({ kind: "draft", id: "ghost" }, [{ id: "d1", cwd: "E:/Dev/a" }]), null);
  assert.equal(resolveDraftTarget({ kind: "draft", id: "d1" }, []), null);
  assert.equal(resolveDraftTarget({ kind: "session", id: "s1" }, [{ id: "d1", cwd: "E:/Dev/a" }]), null);
  assert.equal(resolveDraftTarget(null, []), null);
});

test("reopens the remembered session", () => {
  const target = resolveRestoreTarget({
    projectKey: "E:/Dev/a",
    cwd: "E:/Dev/a",
    lastOpen: { kind: "session", id: "s2" },
    sessions: [S("s1", "E:/Dev/a", "2026-08-15T00:00:00"), S("s2", "E:/Dev/a", "2026-08-16T00:00:00")],
  });
  assert.equal(target.kind, "session");
  assert.equal(target.session?.id, "s2");
});

test("stale remembered session falls back to the latest", () => {
  const target = resolveRestoreTarget({
    projectKey: "E:/Dev/a",
    cwd: "E:/Dev/a",
    lastOpen: { kind: "session", id: "ghost" },
    sessions: [S("s1", "E:/Dev/a", "2026-08-15T00:00:00"), S("s2", "E:/Dev/a", "2026-08-16T00:00:00")],
  });
  assert.equal(target.kind, "session");
  assert.equal(target.session?.id, "s2");
});

test("remembered session that drifted to another workspace falls back", () => {
  const target = resolveRestoreTarget({
    projectKey: "E:/Dev/a",
    cwd: "E:/Dev/a",
    lastOpen: { kind: "session", id: "s1" },
    sessions: [S("s1", "E:/Dev/other", "2026-08-16T00:00:00")],
  });
  // s1 belongs to E:/Dev/other — not this workspace.
  assert.deepEqual(target, { kind: "new-draft", cwd: "E:/Dev/a" });
});

test("no memory picks the workspace's most recent session", () => {
  const target = resolveRestoreTarget({
    projectKey: "E:/Dev/a",
    cwd: "E:/Dev/a",
    lastOpen: null,
    sessions: [
      S("s-old", "E:/Dev/a", "2026-08-14T00:00:00"),
      S("s-new", "E:/Dev/a", "2026-08-16T00:00:00"),
      S("s-other", "E:/Dev/other", "2026-08-17T00:00:00"), // other workspace — excluded
    ],
  });
  assert.equal(target.kind, "session");
  assert.equal(target.session?.id, "s-new");
});

test("workspace with no sessions at all gets a fresh welcome draft", () => {
  const target = resolveRestoreTarget({
    projectKey: "E:/Dev/brand-new",
    cwd: "E:/Dev/brand-new",
    lastOpen: null,
    sessions: [S("s1", "E:/Dev/a", "2026-08-16T00:00:00")],
  });
  assert.deepEqual(target, { kind: "new-draft", cwd: "E:/Dev/brand-new" });
});

test("matches workspace identity across case and separators on Windows", () => {
  const target = resolveRestoreTarget({
    projectKey: "E:/Dev/pi-web-main", // lobby form: forward slashes
    cwd: "E:/Dev/pi-web-main",
    lastOpen: null,
    // pi session record form: backslashes
    sessions: [S("s1", "E:\\Dev\\pi-web-main", "2026-08-16T00:00:00")],
  });
  assert.equal(target.kind, "session");
  assert.equal(target.session?.id, "s1");
});