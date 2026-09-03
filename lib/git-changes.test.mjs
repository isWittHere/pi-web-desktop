import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function createRepository(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-git-changes-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git(cwd, ["init", "-q"]);
  await git(cwd, ["config", "user.email", "test@example.invalid"]);
  await git(cwd, ["config", "user.name", "Test User"]);
  return cwd;
}

async function loadSubject() {
  return jiti.import("./git-changes.ts");
}

test("reports changed files and creates patches for untracked and deleted text files", async (t) => {
  const cwd = await createRepository(t);
  await writeFile(join(cwd, "tracked.txt"), "before\n");
  await writeFile(join(cwd, ".gitignore"), "ignored/\n");
  await git(cwd, ["add", "tracked.txt", ".gitignore"]);
  await git(cwd, ["commit", "-qm", "Initial"]);
  await rm(join(cwd, "tracked.txt"));
  await writeFile(join(cwd, "untracked.txt"), "first\nsecond\n");
  await mkdir(join(cwd, "ignored"));
  await writeFile(join(cwd, "ignored", "generated.txt"), "ignored\n");

  const { getGitFileDiff, getGitStatus } = await loadSubject();
  const status = await getGitStatus(cwd);
  assert.equal(status.isGitRepository, true);
  assert.deepEqual(status.files.map((file) => [basename(file.filePath), file.status]).sort(), [
    ["tracked.txt", "deleted"],
    ["untracked.txt", "untracked"],
  ]);
  assert.equal(status.additions, 2);
  assert.ok(status.ignoredPaths.some((filePath) => basename(filePath) === "ignored"));

  // Per-file diff stats: the deleted tracked file reports its removed line,
  // and the untracked file reports its full content as additions.
  const deletedStat = status.files.find((file) => file.status === "deleted");
  assert.deepEqual([deletedStat.additions, deletedStat.deletions], [0, 1]);
  const untrackedStat = status.files.find((file) => file.status === "untracked");
  assert.deepEqual([untrackedStat.additions, untrackedStat.deletions], [2, null]);

  const untracked = await getGitFileDiff(cwd, join(cwd, "untracked.txt"));
  assert.equal(untracked.supported, true);
  assert.match(untracked.patch ?? "", /\+first/);

  const deleted = await getGitFileDiff(cwd, join(cwd, "tracked.txt"));
  assert.deepEqual(deleted.status, "deleted");
  assert.equal(deleted.supported, true);
  assert.match(deleted.patch ?? "", /-before/);
});

test("reports per-file addition and deletion counts for tracked and renamed files", async (t) => {
  const cwd = await createRepository(t);
  await writeFile(join(cwd, "a.txt"), "one\n");
  await writeFile(join(cwd, "b.txt"), "x\n");
  await git(cwd, ["add", "a.txt", "b.txt"]);
  await git(cwd, ["commit", "-qm", "Initial"]);

  await writeFile(join(cwd, "a.txt"), "one\ntwo\nthree\n");
  await rm(join(cwd, "b.txt"));
  await git(cwd, ["mv", "a.txt", "renamed.txt"]);
  await writeFile(join(cwd, "binary.bin"), Uint8Array.of(0, 1, 2, 0));
  await git(cwd, ["add", "binary.bin"]);

  const { getGitStatus } = await loadSubject();
  const status = await getGitStatus(cwd);
  const byPath = new Map(status.files.map((file) => [basename(file.filePath), file]));

  const renamed = byPath.get("renamed.txt");
  assert.deepEqual([renamed.additions, renamed.deletions], [3, 0]);
  const deleted = byPath.get("b.txt");
  assert.deepEqual([deleted.additions, deleted.deletions], [0, 1]);
  // Binary files have no line counts and must report null so the UI omits the stat.
  const binary = byPath.get("binary.bin");
  assert.equal(binary.additions, null);
  assert.equal(binary.deletions, null);

  // Header totals must equal the sum of the per-file stats.
  const totals = status.files.reduce(
    (counts, file) => {
      counts.additions += file.additions ?? 0;
      counts.deletions += file.deletions ?? 0;
      return counts;
    },
    { additions: 0, deletions: 0 },
  );
  assert.equal(status.additions, totals.additions);
  assert.equal(status.deletions, totals.deletions);
});

test("reports fully staged renames from the grouped numstat format", async (t) => {
  const cwd = await createRepository(t);
  await writeFile(join(cwd, "a.txt"), "one\ntwo\n");
  await git(cwd, ["add", "a.txt"]);
  await git(cwd, ["commit", "-qm", "Initial"]);

  // A pure staged rename (no content change) is emitted by numstat -z as an
  // empty-path counts record followed by the original and the new path.
  await git(cwd, ["mv", "a.txt", "renamed.txt"]);

  const { getGitStatus } = await loadSubject();
  const status = await getGitStatus(cwd);
  const byPath = new Map(status.files.map((file) => [basename(file.filePath), file]));

  // The renamed row must carry the grouped record's 0/0 counts instead of
  // falling back to null (which would hide the stat in the UI).
  const renamed = byPath.get("renamed.txt");
  assert.deepEqual([renamed.additions, renamed.deletions], [0, 0]);
  assert.equal(byPath.has("a.txt"), false);
  assert.equal(status.additions, 0);
  assert.equal(status.deletions, 0);
});

test("matches existing tracked paths against updated ignore rules", async (t) => {
  const cwd = await createRepository(t);
  await mkdir(join(cwd, "existing-directory"));
  await writeFile(join(cwd, "existing-directory", "file.txt"), "tracked\n");
  await writeFile(join(cwd, ".gitignore"), "\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-qm", "Initial"]);

  const { getGitStatus } = await loadSubject();
  await writeFile(join(cwd, ".gitignore"), "existing-directory/\n");
  const ignored = await getGitStatus(cwd);
  assert.ok(ignored.ignoredPaths.some((filePath) => basename(filePath) === "existing-directory"));
  assert.ok(ignored.ignoredPaths.some((filePath) => basename(filePath) === "file.txt"));

  await writeFile(join(cwd, ".gitignore"), "\n");
  const refreshed = await getGitStatus(cwd);
  assert.ok(!refreshed.ignoredPaths.some((filePath) => basename(filePath) === "existing-directory"));
});
