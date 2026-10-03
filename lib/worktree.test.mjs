import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);

// worktree.ts imports via the `@/` alias and package-only modules (allowed-roots
// → file-access); jiti resolves both the way the Next build does.
const jiti = createJiti(import.meta.url);
const loadSubject = (file = "./path-compare.ts") => jiti.import(file);

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

test("recognizes submodule and dirty-worktree removal errors as forceable", async () => {
  const { worktreeRemovalRequiresForce } = await loadSubject("./worktree.ts");

  assert.equal(worktreeRemovalRequiresForce("fatal: working trees containing submodules cannot be moved or removed"), true);
  assert.equal(worktreeRemovalRequiresForce("fatal: '/tmp/linked' contains modified or untracked files, use --force to delete it"), true);
  assert.equal(worktreeRemovalRequiresForce("fatal: worktree is dirty"), true);
  // A locked worktree needs `remove -f -f`; a single force would still fail.
  assert.equal(worktreeRemovalRequiresForce("fatal: cannot remove a locked working tree;\nuse 'remove -f -f' to override or unlock first"), false);
  assert.equal(worktreeRemovalRequiresForce("fatal: unrelated git failure"), false);
});

async function initRepoWithWorktree(tempRoot, branch) {
  const repo = join(tempRoot, "repo");
  const linked = join(tempRoot, "linked");
  await execFileAsync("git", ["init", repo]);
  await execFileAsync("git", ["-C", repo, "config", "user.name", "Pi Web Test"]);
  await execFileAsync("git", ["-C", repo, "config", "user.email", "pi-web-test@example.invalid"]);
  await execFileAsync("git", ["-C", repo, "config", "commit.gpgsign", "false"]);
  await writeFile(join(repo, "README.md"), "# test\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "commit", "-m", "initial"]);
  await execFileAsync("git", ["-C", repo, "worktree", "add", "-b", branch, linked]);
  return { repo, linked };
}

test("forced worktree removal passes Git's force flag", async (t) => {
  const tempRoot = await mkdtemp(join(process.env.TEMP ?? "/tmp", "pi-web-worktree-force-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const { repo, linked } = await initRepoWithWorktree(tempRoot, "feature/force");
  await writeFile(join(linked, "untracked.txt"), "discard me\n");

  const { removeWorktree } = await loadSubject("./worktree.ts");
  await removeWorktree(repo, linked, true);
  assert.equal(existsSync(linked), false);
});
