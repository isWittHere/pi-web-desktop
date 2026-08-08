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
