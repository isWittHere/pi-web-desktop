import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { resolveAllowedNewSessionCwd } = await jiti.import("./route.ts");

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "pi-web-agent-new-"));
  const allowedRoot = path.join(root, "allowed");
  const allowedChild = path.join(allowedRoot, "child");
  const outsideDirectory = path.join(root, "outside");
  const file = path.join(root, "file.txt");
  mkdirSync(allowedChild, { recursive: true });
  mkdirSync(outsideDirectory);
  writeFileSync(file, "not a directory");
  return { root, allowedRoot, allowedChild, outsideDirectory, file };
}

test("accepts only real directories inside existing allowed roots", () => {
  const fixture = createFixture();
  try {
    const roots = new Set([fixture.allowedRoot]);
    assert.equal(resolveAllowedNewSessionCwd(fixture.allowedRoot, roots), path.resolve(fixture.allowedRoot));
    assert.equal(resolveAllowedNewSessionCwd(fixture.allowedChild, roots), path.resolve(fixture.allowedChild));
    assert.equal(resolveAllowedNewSessionCwd(fixture.outsideDirectory, roots), null);
    assert.equal(resolveAllowedNewSessionCwd(fixture.file, roots), null);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a directory link inside an allowed root when it resolves outside", () => {
  const fixture = createFixture();
  const linkedDirectory = path.join(fixture.allowedRoot, "outside-link");
  try {
    symlinkSync(fixture.outsideDirectory, linkedDirectory, "junction");
    assert.equal(resolveAllowedNewSessionCwd(linkedDirectory, new Set([fixture.allowedRoot])), null);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("does not treat stale allowed roots as authorization", () => {
  const fixture = createFixture();
  try {
    assert.equal(
      resolveAllowedNewSessionCwd(fixture.outsideDirectory, new Set([path.join(fixture.root, "missing")])),
      null,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
