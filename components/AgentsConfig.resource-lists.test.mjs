import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentsConfig.tsx", import.meta.url), "utf8");
const en = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zh = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("the Agents panel shows what a profile's skills and extensions lists load", () => {
  // Both lists are edited in the profile file, so the panel only reports them.
  assert.match(source, /draft\.loadSkills && draft\.skills !== undefined/);
  assert.match(source, /draft\.loadExtensions && draft\.extensions !== undefined/);
  assert.match(source, /t\("agents\.skillsOnly", \{ skills: draft\.skills\.join\(", "\) \}\)/);
  assert.match(source, /t\("agents\.extensionsOnly", \{ extensions: draft\.extensions\.join\(", "\) \}\)/);
  assert.match(source, /t\("agents\.skillsNone"\)/);
  assert.match(source, /t\("agents\.extensionsNone"\)/);
  // The draft carries the lists through from the profile.
  assert.match(source, /\.\.\.\(profile\.skills !== undefined \? \{ skills: \[\.\.\.profile\.skills\] \} : \{\}\),/);
  assert.match(source, /\.\.\.\(profile\.extensions !== undefined \? \{ extensions: \[\.\.\.profile\.extensions\] \} : \{\}\),/);
});

test("every key the panel picks for those lines exists in both catalogs", () => {
  for (const key of ["agents.skillsOnly", "agents.skillsNone", "agents.extensionsOnly", "agents.extensionsNone"]) {
    assert.ok(en.includes(`"${key}"`), `${key} is missing from en.ts`);
    assert.ok(zh.includes(`"${key}"`), `${key} is missing from zh-CN.ts`);
  }
  // The interpolation placeholders match the call sites.
  assert.match(en, /"agents\.skillsOnly": "Loads only these skills: \{skills\}"/);
  assert.match(en, /"agents\.extensionsOnly": "Loads only these extensions: \{extensions\}"/);
});
