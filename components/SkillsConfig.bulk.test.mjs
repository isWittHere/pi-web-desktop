import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { skillsToSwitch, applySkillToggleResults } = await jiti.import("./SkillsConfig.tsx");

const skill = (name, disableModelInvocation) => ({ name, filePath: `/tmp/${name}.md`, disableModelInvocation });

test("skillsToSwitch returns the skills a bulk switch would change", () => {
  const skills = [skill("a", false), skill("b", true), skill("c", false)];
  assert.deepEqual(skillsToSwitch(skills, true).map((s) => s.name), ["b"]);
  assert.deepEqual(skillsToSwitch(skills, false).map((s) => s.name), ["a", "c"]);
});

test("a skill whose file reported an error keeps its state", () => {
  const skills = [skill("a", false), skill("b", false)];
  const results = [
    { filePath: "/tmp/a.md" },
    { filePath: "/tmp/b.md", error: "Not a skill file" },
  ];
  const next = applySkillToggleResults(skills, results, true);
  assert.deepEqual(next.map((s) => [s.name, s.disableModelInvocation]), [["a", true], ["b", false]]);
});
