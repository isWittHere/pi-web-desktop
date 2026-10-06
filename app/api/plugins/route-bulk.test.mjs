import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// POST /api/plugins with `packages` is the panel's "Enable all" / "Disable all":
// one settings write per scope, one result per package, and a package it
// refuses (unconfigured, or filtered for a disable) does not stop the rest.
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-plugins-bulk-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const cwd = await mkdtemp(join(tmpdir(), "pi-web-plugins-bulk-cwd-"));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access");
const { SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");

await allowFileRoot(cwd);

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

function post(body) {
  return new Request("http://localhost/api/plugins", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

async function writeGlobalPackages(packages) {
  const settingsManager = SettingsManager.create(cwd, testAgentDir, { projectTrusted: true });
  settingsManager.setPackages(packages);
  await settingsManager.flush();
}

function readGlobalPackages() {
  return SettingsManager.create(cwd, testAgentDir, { projectTrusted: true }).getGlobalSettings().packages ?? [];
}

test("a bulk disable turns every plain package off in one write", async () => {
  await writeGlobalPackages(["npm:a", "npm:b"]);
  const response = await POST(post({
    action: "disable",
    cwd,
    packages: [
      { source: "npm:a", scope: "global" },
      { source: "npm:b", scope: "global" },
    ],
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.results, [
    { source: "npm:a", scope: "global" },
    { source: "npm:b", scope: "global" },
  ]);
  const packages = readGlobalPackages();
  for (const entry of packages) {
    assert.ok(typeof entry === "object" && Array.isArray(entry.extensions) && entry.extensions.length === 0);
  }
});

test("a bulk enable restores the bare source", async () => {
  await writeGlobalPackages([
    { source: "npm:a", extensions: [], skills: [], prompts: [], themes: [] },
  ]);
  const response = await POST(post({
    action: "enable",
    cwd,
    packages: [{ source: "npm:a", scope: "global" }],
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(readGlobalPackages(), ["npm:a"]);
});

test("Disable all leaves an enabled filtered package on and reports it", async () => {
  await writeGlobalPackages([
    "npm:plain",
    { source: "npm:filtered", extensions: ["one"], skills: [], prompts: [], themes: [] },
  ]);
  const response = await POST(post({
    action: "disable",
    cwd,
    packages: [
      { source: "npm:plain", scope: "global" },
      { source: "npm:filtered", scope: "global" },
    ],
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  const bySource = Object.fromEntries(data.results.map((result) => [result.source, result.error]));
  assert.equal(bySource["npm:plain"], undefined);
  assert.match(bySource["npm:filtered"], /resource filters/);
  const packages = readGlobalPackages();
  const filtered = packages.find((entry) => (typeof entry === "string" ? entry : entry.source) === "npm:filtered");
  assert.deepEqual(filtered.extensions, ["one"]);
});

test("a package that is not configured is reported, not fatal", async () => {
  await writeGlobalPackages(["npm:a"]);
  const response = await POST(post({
    action: "disable",
    cwd,
    packages: [
      { source: "npm:a", scope: "global" },
      { source: "npm:missing", scope: "global" },
    ],
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  const bySource = Object.fromEntries(data.results.map((result) => [result.source, result.error]));
  assert.equal(bySource["npm:a"], undefined);
  assert.match(bySource["npm:missing"], /not configured/);
});

test("packages with an action other than enable/disable is refused", async () => {
  const response = await POST(post({
    action: "install",
    cwd,
    packages: [{ source: "npm:a", scope: "global" }],
  }));
  assert.equal(response.status, 400);
});
