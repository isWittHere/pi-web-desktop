import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

async function loadSubject() {
  return import("./path-compare.ts");
}

const isWin = process.platform === "win32";

test("sameResolvedPath treats git POSIX output and native separators as equal", async () => {
  const { sameResolvedPath } = await loadSubject();
  // Build the same path twice: native separators and a POSIX-style variant
  // (what `git rev-parse --show-toplevel` prints on Windows).
  const native = join("E:", "Dev", "pi-web-main");
  const posix = native.replace(/\\/g, "/");
  assert.ok(sameResolvedPath(posix, native));
  assert.ok(sameResolvedPath(native, posix));
  assert.ok(sameResolvedPath(native, native));
});

test("sameResolvedPath distinguishes the repo root from its subdirectories", async () => {
  const { sameResolvedPath } = await loadSubject();
  const root = join("E:", "Dev", "pi-web-main");
  const subdir = join(root, "lib");
  assert.equal(sameResolvedPath(subdir, root), false);
  assert.equal(sameResolvedPath(root, subdir), false);
});

test("sameResolvedPath ignores drive/folder case on Windows", async () => {
  const { sameResolvedPath } = await loadSubject();
  const root = join("E:", "Dev", "pi-web-main");
  const lower = root.toLowerCase();
  if (isWin) {
    assert.ok(sameResolvedPath(lower, root));
  } else {
    // POSIX is case-sensitive: the comparison must remain strict.
    assert.equal(sameResolvedPath(lower, root), root === lower);
  }
});

test("sameResolvedPath handles trailing separators", async () => {
  const { sameResolvedPath } = await loadSubject();
  const root = join("E:", "Dev", "pi-web-main");
  const withSep = root + (isWin ? "\\" : "/");
  assert.ok(sameResolvedPath(withSep, root));
});

test("addWorktree raises git timeouts and prefers a fetched remote tip", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./worktree.ts", import.meta.url), "utf8");

  // The git helper accepts a per-call timeout (default unchanged).
  assert.match(source, /async function git\(cwd: string, args: string\[\], timeoutMs = 10_000\)/);
  assert.match(source, /timeout: timeoutMs/);
  // Large-repo checkouts get a five-minute budget.
  assert.match(source, /const WORKTREE_TIMEOUT = 5 \* 60_000/);
  // New branches start from the remote-tracking tip when present, else HEAD.
  assert.match(source, /refs\/remotes\/origin\/\$\{trimmed\}/);
  assert.match(source, /let startFrom: string \| undefined/);
  assert.match(source, /if \(startFrom\) addArgs\.push\(startFrom\)/);
  // Creation stays offline-safe: no implicit fetch call.
  assert.doesNotMatch(source, /git\(repoRoot, \["fetch"/);
});
