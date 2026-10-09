import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-diff-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalAllowedRoots;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRootsCache;
  globalThis.__piAdditionalAllowedRoots = previousAdditionalRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access.ts");
const { NextRequest } = await jiti.import("next/server");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(base, "repo-")));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  allowFileRoot(root);
  // The allowed-roots snapshot is cached for 5s, so a fixture added after an
  // earlier request would otherwise be invisible to the route.
  delete globalThis.__piAllowedRootsCache;
  return root;
}

function request(cwd, filePath) {
  const url = new URL("http://localhost/api/git/diff");
  url.searchParams.set("cwd", cwd);
  url.searchParams.set("path", filePath);
  // The route's first gate is the Host/Origin check, which needs the header.
  return GET(new NextRequest(url, { headers: { host: "localhost" } }));
}

function directoryLink(target, link) {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

test("refuses a file reached through an outside junction before returning any content", async () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside-secret-marker\n");
  directoryLink(outside, path.join(root, "linked"));

  const response = await request(root, path.join(root, "linked", "secret.txt"));
  assert.equal(response.status, 403);
  const body = await response.text();
  assert.doesNotMatch(body, /outside-secret-marker/);
});

test("a deleted file is still diffed, through its nearest existing ancestor", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "gone.txt"), "first\n");
  git(root, "add", "gone.txt");
  git(root, "commit", "--quiet", "-m", "add gone.txt");
  fs.rmSync(path.join(root, "gone.txt"));

  const response = await request(root, path.join(root, "gone.txt"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(String(body.patch ?? ""), /^-first$/m);
});

test("a path outside the allowed roots is refused", async () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside-secret-marker\n");

  const response = await request(root, path.join(outside, "secret.txt"));
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /outside-secret-marker/);
});

test("a parent-directory segment is refused outright", async () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside-secret-marker\n");

  const response = await request(root, path.join(root, "..", path.basename(outside), "secret.txt"));
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /outside-secret-marker/);
});

test("the route authorizes cwd as an existing path too, not just by prefix", async () => {
  const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /isExistingFilePathAllowed\(cwd, allowedRoots\) \|\| !isDiffPathAllowed\(filePath, allowedRoots\)/);
  // A junction inside a repository must not pass on a string prefix alone.
  assert.match(source, /lstatSync\(candidate\)/);
  assert.match(source, /isExistingFilePathAllowed\(candidate, allowedRoots\)/);
});
