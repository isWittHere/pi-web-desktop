import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);
const jiti = createJiti(import.meta.url);

async function git(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

async function loadSubject() {
  return jiti.import("./git-changes.ts");
}

test("reports changed files and creates patches for untracked and deleted text files", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-git-changes-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await git(cwd, ["init", "-q"]);
  await git(cwd, ["config", "user.email", "test@example.invalid"]);
  await git(cwd, ["config", "user.name", "Test User"]);
  await writeFile(join(cwd, "tracked.txt"), "before\n");
  await git(cwd, ["add", "tracked.txt"]);
  await git(cwd, ["commit", "-qm", "Initial"]);
  await rm(join(cwd, "tracked.txt"));
  await writeFile(join(cwd, "untracked.txt"), "first\nsecond\n");

  const { getGitFileDiff, getGitStatus } = await loadSubject();
  const status = await getGitStatus(cwd);
  assert.equal(status.isGitRepository, true);
  assert.deepEqual(status.files.map((file) => [basename(file.filePath), file.status]).sort(), [
    ["tracked.txt", "deleted"],
    ["untracked.txt", "untracked"],
  ]);
  assert.equal(status.additions, 2);

  const untracked = await getGitFileDiff(cwd, join(cwd, "untracked.txt"));
  assert.equal(untracked.supported, true);
  assert.match(untracked.patch ?? "", /\+first/);

  const deleted = await getGitFileDiff(cwd, join(cwd, "tracked.txt"));
  assert.deepEqual(deleted.status, "deleted");
  assert.equal(deleted.supported, true);
  assert.match(deleted.patch ?? "", /-before/);
});
