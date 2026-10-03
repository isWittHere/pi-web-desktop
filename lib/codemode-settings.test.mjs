import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  DEFAULT_CODEMODE_INLINE_BUDGET,
  findProjectCodemodeOverride,
  getCodemodeSandboxResult,
  readCodemodeChoice,
  readCodemodeChoiceFromDisk,
  readCodemodeConfig,
  setCodemodeSandboxResult,
  writeCodemodeChoice,
  writeCodemodeConfig,
} = await jiti.import("./codemode-settings.ts");

// findProjectCodemodeOverride consults the trust store; every test keeps its
// own agentDir so nothing touches the real ~/.pi/agent.

async function createCodemodeFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-codemode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("readCodemodeChoice reads the effective resolved defaultTools", () => {
  assert.equal(readCodemodeChoice({}), "automatic");
  assert.equal(readCodemodeChoice({ defaultTools: ["read", "bash"] }), "automatic");
  assert.equal(readCodemodeChoice({ defaultTools: ["+codemode"] }), "always");
  assert.equal(readCodemodeChoice({ defaultTools: ["read", "codemode"] }), "always");
  assert.equal(readCodemodeChoice({ defaultTools: ["-bash", "+codemode"] }), "always");
  // An explicit empty list resolves to no tools, so not "always".
  assert.equal(readCodemodeChoice({ defaultTools: [] }), "automatic");
  assert.throws(() => readCodemodeChoice({ defaultTools: "bash" }), /defaultTools must be an array/);
});

test("writeCodemodeChoice edits the resolved list and round-trips both ways", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-codemode-"));
  const settingsPath = join(root, "settings.json");
  try {
    // An absent defaultTools resolves to pi's defaults; "always" keeps them.
    assert.equal(await writeCodemodeChoice("always", settingsPath), "always");
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
      defaultTools: ["read", "bash", "edit", "write", "codemode"],
    });
    assert.equal(await readCodemodeChoiceFromDisk(settingsPath), "always");

    // A modifier-only list resolves against pi's defaults before editing.
    await writeFile(settingsPath, JSON.stringify({ unrelated: true, defaultTools: ["+codemode", "-bash"] }));
    assert.equal(await writeCodemodeChoice("automatic", settingsPath), "automatic");
    const stored = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(stored.defaultTools, ["read", "edit", "write"]);
    assert.equal(stored.unrelated, true);
    assert.equal(await readCodemodeChoiceFromDisk(settingsPath), "automatic");

    // "automatic" on an unpinned file is a stable no-op, not an empty list.
    await writeFile(settingsPath, "{}");
    assert.equal(await writeCodemodeChoice("automatic", settingsPath), "automatic");
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).defaultTools, [
      "read", "bash", "edit", "write",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeCodemodeConfig edits mode and inlineBudget under the same lock file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-codemode-config-"));
  const settingsPath = join(root, "settings.json");
  try {
    assert.deepEqual(await readCodemodeConfig(settingsPath), {
      mode: "on",
      inlineBudget: DEFAULT_CODEMODE_INLINE_BUDGET,
    });
    assert.deepEqual(
      await writeCodemodeConfig({ mode: "only", inlineBudget: 8000 }, settingsPath),
      { mode: "only", inlineBudget: 8000 },
    );
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).codemode, {
      mode: "only",
      inlineBudget: 8000,
    });

    // The two writers share the lock and preserve each other's entries.
    await writeCodemodeChoice("always", settingsPath);
    assert.equal(await readCodemodeChoiceFromDisk(settingsPath), "always");
    assert.deepEqual(await readCodemodeConfig(settingsPath), { mode: "only", inlineBudget: 8000 });

    // Out-of-range values normalize to the defaults on read and are refused on write.
    await writeFile(settingsPath, JSON.stringify({ codemode: { mode: "weird", inlineBudget: -1 } }));
    assert.deepEqual(await readCodemodeConfig(settingsPath), {
      mode: "on",
      inlineBudget: DEFAULT_CODEMODE_INLINE_BUDGET,
    });
    await assert.rejects(() => writeCodemodeConfig({ mode: "weird" }, settingsPath), /Invalid codemode mode/);
    await assert.rejects(
      () => writeCodemodeConfig({ inlineBudget: -1 }, settingsPath),
      /Invalid codemode inlineBudget/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the sandbox self-test result is stored per process", async () => {
  assert.deepEqual(getCodemodeSandboxResult().available, false);
  assert.match(getCodemodeSandboxResult().error ?? "", /not run yet/);
  setCodemodeSandboxResult({ available: true });
  assert.deepEqual(getCodemodeSandboxResult(), { available: true });
  setCodemodeSandboxResult({ available: false, error: "QuickJS failed" });
  assert.deepEqual(getCodemodeSandboxResult(), { available: false, error: "QuickJS failed" });
  setCodemodeSandboxResult({ available: true });
});

test("findProjectCodemodeOverride flags trusted projects that govern defaultTools", async (t) => {
  const root = await createCodemodeFixture(t);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const projectSettings = join(cwd, ".pi", "settings.json");
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["+codemode"] }));

  // The project settings.json is a trust-requiring resource; before the user
  // trusts it the global file stays authoritative.
  assert.equal(findProjectCodemodeOverride(cwd, agentDir), undefined);

  const { trustProject } = await jiti.import("./project-trust.ts");
  await trustProject(cwd, agentDir);
  assert.equal(findProjectCodemodeOverride(cwd, agentDir), projectSettings);

  // Other modifiers merely append to the inherited list: not an override.
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["+tool-search"] }));
  assert.equal(findProjectCodemodeOverride(cwd, agentDir), undefined);

  // Plain names replace the inherited list and ±codemode modifiers decide
  // codemode directly — either governs the choice.
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["read", "grep"] }));
  assert.equal(findProjectCodemodeOverride(cwd, agentDir), projectSettings);
  await writeFile(projectSettings, JSON.stringify({ defaultTools: ["-codemode"] }));
  assert.equal(findProjectCodemodeOverride(cwd, agentDir), projectSettings);
});
