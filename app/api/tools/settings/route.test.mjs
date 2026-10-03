import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-tools-settings-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function put(body, contentType = "application/json") {
  return new Request("http://localhost/api/tools/settings", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: JSON.stringify(body),
  });
}

function get(cwd) {
  const url = new URL("http://localhost/api/tools/settings");
  if (cwd) url.searchParams.set("cwd", cwd);
  return new Request(url, { headers: { Host: "localhost" } });
}

test("GET reports the codemode choice and the sandbox self-test state", async () => {
  const response = await GET(get());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.isWindows, process.platform === "win32");
  assert.equal(data.powerShellEnabled, false);
  assert.equal(data.codemode, "automatic");
  // The self-test has not run in this process: explicit, not a silent true.
  assert.equal(data.sandboxAvailable, false);
  assert.match(data.sandboxError ?? "", /not run yet/);
});

test("PUT writes the codemode choice into the global defaultTools both ways", async () => {
  let response = await PUT(put({ codemode: "always" }));
  assert.equal(response.status, 200);
  let data = await response.json();
  assert.equal(data.codemode, "always");
  assert.deepEqual(
    (JSON.parse(await readFile(join(testAgentDir, "settings.json"), "utf8"))).defaultTools,
    ["read", "bash", "edit", "write", "codemode"],
  );

  response = await PUT(put({ codemode: "automatic" }));
  data = await response.json();
  assert.equal(data.codemode, "automatic");
  assert.deepEqual(
    (JSON.parse(await readFile(join(testAgentDir, "settings.json"), "utf8"))).defaultTools,
    ["read", "bash", "edit", "write"],
  );
});

test("PUT validates the codemode value and body shape", async () => {
  let response = await PUT(put({ codemode: "yes" }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /codemode must be/);

  response = await PUT(put({}));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /enabled or codemode is required/);

  response = await PUT(put({ codemode: "always" }, "text/plain"));
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json" });

  // The PowerShell half keeps its Windows-only gate.
  response = await PUT(put({ enabled: true }));
  assert.equal(response.status, process.platform === "win32" ? 200 : 404);
});

test("a trusted project settings.json governing defaultTools shadows the global write with 409", async () => {
  // Reset to a known global state (earlier tests may have toggled the shell).
  await writeFile(join(testAgentDir, "settings.json"), JSON.stringify({
    defaultTools: ["read", "bash", "edit", "write", "codemode"],
  }));

  const project = join(testAgentDir, "override-project");
  await mkdir(join(project, ".pi"), { recursive: true });
  const projectSettings = join(project, ".pi", "settings.json");
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["+codemode"] }));

  const { trustProject } = await jiti.import("@/lib/project-trust.ts");
  await trustProject(project, testAgentDir);

  const response = await PUT(put({ codemode: "automatic", cwd: project }));
  assert.equal(response.status, 409);
  const data = await response.json();
  assert.equal(data.file, projectSettings);
  // The global file is untouched by the refused write (it still carries the
  // codemode pin the reset above wrote).
  assert.deepEqual(
    (JSON.parse(await readFile(join(testAgentDir, "settings.json"), "utf8"))).defaultTools,
    ["read", "bash", "edit", "write", "codemode"],
  );

  // GET reports the effective (project) choice and the overriding file.
  const got = await GET(get(project));
  const overview = await got.json();
  assert.equal(overview.codemode, "always");
  assert.equal(overview.projectOverride, projectSettings);

  // An untrusted project does not shadow anything.
  const untrusted = join(testAgentDir, "untrusted-project");
  await mkdir(join(untrusted, ".pi"), { recursive: true });
  await writeFile(join(untrusted, ".pi", "settings.json"), JSON.stringify({ defaultTools: ["+codemode"] }));
  const ungated = await PUT(put({ codemode: "automatic", cwd: untrusted }));
  assert.equal(ungated.status, 200);
});
