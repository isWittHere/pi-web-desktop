import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// One PATCH for the whole list: each skill file is edited on its own and
// reported separately, so a file the route refuses does not stop the rest.
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-skills-bulk-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const cwd = await mkdtemp(join(tmpdir(), "pi-web-skills-bulk-cwd-"));
await mkdir(join(cwd, "skills"), { recursive: true });

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { PATCH } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access");

await allowFileRoot(cwd);
await allowFileRoot(testAgentDir);

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

const SKILL = "---\nname: demo\ndescription: demo\n---\n\nbody\n";

async function writeSkill(name, content = SKILL) {
  const filePath = join(cwd, "skills", name);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function patch(body) {
  return new Request("http://localhost/api/skills", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("a batch toggles every listed skill and reports each one", async () => {
  const a = await writeSkill("a.md");
  const b = await writeSkill("b.md");
  const response = await PATCH(patch({ cwd, filePaths: [a, b], disableModelInvocation: true }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.results, [{ filePath: a }, { filePath: b }]);
  assert.match(await readFile(a, "utf8"), /disable-model-invocation:\s*true/);
  assert.match(await readFile(b, "utf8"), /disable-model-invocation:\s*true/);
});

test("a file the route refuses is reported and the rest still switch", async () => {
  const good = await writeSkill("good.md");
  const nonMarkdown = join(cwd, "skills", "auth.json");
  await writeFile(nonMarkdown, "{}\n", "utf8");
  const response = await PATCH(patch({
    cwd,
    filePaths: [good, nonMarkdown],
    disableModelInvocation: true,
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  const byPath = Object.fromEntries(data.results.map((result) => [result.filePath, result.error]));
  assert.equal(byPath[good], undefined);
  assert.equal(byPath[nonMarkdown], "Not a skill file");
  assert.match(await readFile(good, "utf8"), /disable-model-invocation:\s*true/);
  assert.equal(await readFile(nonMarkdown, "utf8"), "{}\n");
});

test("a skill already in the requested state is left untouched", async () => {
  const filePath = await writeSkill("already.md", "---\nname: demo\ndescription: demo\ndisable-model-invocation: true\n---\n\nbody\n");
  const before = await readFile(filePath, "utf8");
  const response = await PATCH(patch({ cwd, filePaths: [filePath], disableModelInvocation: true }));
  assert.equal(response.status, 200);
  assert.equal(await readFile(filePath, "utf8"), before);
});

test("a non-list filePaths is refused", async () => {
  const response = await PATCH(patch({ cwd, filePaths: "nope", disableModelInvocation: true }));
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.match(data.error, /filePaths/);
});
