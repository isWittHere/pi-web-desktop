import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createSubagentSkillsBinding } = await jiti.import("./subagent-skills.ts");

const skill = (name, dir) => ({
  name,
  filePath: join(dir, `${name}.md`),
  baseDir: dir,
});

test("a named skill is projected into the prompt, and the catalog stays hidden", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-skills-"));
  try {
    writeFileSync(join(dir, "alpha.md"), "---\nname: alpha\n---\n\nAlpha body text.\n");
    writeFileSync(join(dir, "beta.md"), "---\nname: beta\n---\n\nBeta body text.\n");
    const discovered = [skill("alpha", dir), skill("beta", dir)];

    const binding = createSubagentSkillsBinding({ loadSkills: true, skills: ["alpha"] });
    // The loader hides the catalog in named mode but keeps what it discovered.
    const loaded = binding.loaderOptions.skillsOverride({ skills: discovered, diagnostics: ["keep"] });
    assert.deepEqual(loaded.skills, []);
    assert.deepEqual(loaded.diagnostics, ["keep"]);
    assert.equal(binding.loaderOptions.noSkills, false);

    // The projection runs through before_agent_start, so drive it the way the SDK would.
    const handlers = [];
    const compose = binding.loaderOptions.extensionFactories[0];
    compose.factory({ on: (_event, handler) => handlers.push(handler) });
    const event = { systemPrompt: "BASE PROMPT" };
    const answer = handlers[0](event);
    assert.equal(answer.systemPrompt, "BASE PROMPT\n\n## Skill: alpha\nLocation: " + join(dir, "alpha.md") + "\nBase directory for relative references: " + dir + "\n\nAlpha body text.");
    // The other skill is not projected.
    assert.doesNotMatch(answer.systemPrompt, /Beta body text/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown name is reported in the prompt rather than used as a path", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-skills-"));
  try {
    writeFileSync(join(dir, "alpha.md"), "---\nname: alpha\n---\n\nAlpha body text.\n");
    const binding = createSubagentSkillsBinding({ loadSkills: true, skills: ["nope"] });
    binding.loaderOptions.skillsOverride({ skills: [skill("alpha", dir)], diagnostics: [] });
    const handlers = [];
    binding.loaderOptions.extensionFactories[0].factory({ on: (_e, h) => handlers.push(h) });
    const answer = handlers[0]({ systemPrompt: "BASE" });
    assert.match(answer.systemPrompt, /Skill "nope" not found in SDK discovery\./);
    assert.doesNotMatch(answer.systemPrompt, /Alpha body text/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("load_skills: false wins over a list, and an absent list keeps the catalog", () => {
  const off = createSubagentSkillsBinding({ loadSkills: false, skills: ["alpha"] });
  assert.equal(off.loaderOptions.noSkills, true);
  assert.equal(off.loaderOptions.skillsOverride, undefined);
  assert.equal(off.loaderOptions.extensionFactories, undefined);

  const catalog = createSubagentSkillsBinding({ loadSkills: true });
  assert.equal(catalog.loaderOptions.noSkills, false);
  // No names and no exact prompt: nothing to project, so no extension is registered.
  assert.equal(catalog.loaderOptions.skillsOverride, undefined);
  assert.equal(catalog.loaderOptions.extensionFactories, undefined);
});

test("the exact prompt is composed with the skills text, not replaced by it", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-skills-"));
  try {
    writeFileSync(join(dir, "alpha.md"), "---\nname: alpha\n---\n\nAlpha body text.\n");
    const binding = createSubagentSkillsBinding({
      loadSkills: true,
      skills: ["alpha"],
      exactSystemPrompt: "EXACT PROMPT",
    });
    binding.loaderOptions.skillsOverride({ skills: [skill("alpha", dir)], diagnostics: [] });
    const handlers = [];
    binding.loaderOptions.extensionFactories[0].factory({ on: (_e, h) => handlers.push(h) });
    const answer = handlers[0]({ systemPrompt: "pi's own prompt" });
    assert.match(answer.systemPrompt, /^EXACT PROMPT\n\n## Skill: alpha/);
    assert.doesNotMatch(answer.systemPrompt, /pi's own prompt/);
    // The wrapper reads the composed prompt lazily, after discovery.
    assert.equal(binding.getExactSystemPrompt(), answer.systemPrompt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a profile's skills list round-trips through a save untouched", async () => {
  const { saveSubagentProfile, listSubagentProfiles } = await jiti.import("./subagents.ts");
  const dir = mkdtempSync(join(tmpdir(), "pi-web-skills-profile-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const cwd = join(dir, "project");
    mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
    const file = join(cwd, ".pi", "agents", "reader.md");
    writeFileSync(file, [
      "---",
      "description: Reads things",
      "load_skills: true",
      "skills:",
      "  - alpha",
      "---",
      "",
      "Read.",
      "",
    ].join("\n"));

    const [profile] = listSubagentProfiles(cwd).filter((p) => p.name === "reader");
    assert.equal(profile.loadSkills, true);
    assert.deepEqual(profile.skills, ["alpha"]);

    const saved = saveSubagentProfile(cwd, "project", { ...profile, description: "Reads things" });
    assert.deepEqual(saved.skills, ["alpha"]);
    assert.match(readFileSync(file, "utf8"), /skills:\n {2}- alpha\n/);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
