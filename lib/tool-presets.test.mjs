import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  PRESET_DEFAULT,
  PRESET_FULL,
  PRESET_NONE,
  PRESET_READ_ONLY,
  deriveToolNamesFromActive,
  getPresetFromTools,
  getToolNamesForPreset,
} = await jiti.import("./tool-presets.ts");

const BUILTIN_NAMES = ["bash", "powershell", "read", "edit", "write", "grep", "find", "ls"];

function toolEntries(activeNames, customNames = []) {
  const active = new Set(activeNames);
  return [...BUILTIN_NAMES, ...customNames].map((name) => ({
    name,
    description: name,
    active: active.has(name),
  }));
}

test("maps every tool preset to its built-in tools", () => {
  assert.deepEqual(getToolNamesForPreset("none"), PRESET_NONE);
  assert.deepEqual(getToolNamesForPreset("read-only"), PRESET_READ_ONLY);
  assert.deepEqual(getToolNamesForPreset("default"), PRESET_DEFAULT);
  assert.deepEqual(getToolNamesForPreset("full"), PRESET_FULL);
  assert.deepEqual(PRESET_READ_ONLY, ["read", "grep", "find", "ls"]);
});

test("recognizes presets while ignoring active custom tools", () => {
  const customNames = ["web_search", "delegate"];

  assert.equal(getPresetFromTools(toolEntries([], customNames)), "none");
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_READ_ONLY, ...customNames], customNames)),
    "read-only",
  );
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_DEFAULT, ...customNames], customNames)),
    "default",
  );
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_FULL, ...customNames], customNames)),
    "full",
  );
});

test("returns fresh tool arrays that callers can safely modify", () => {
  const names = getToolNamesForPreset("read-only");
  names.push("custom");
  assert.deepEqual(getToolNamesForPreset("read-only"), PRESET_READ_ONLY);
});

test("recognizes PowerShell as the shell in standard presets", () => {
  assert.equal(
    getPresetFromTools(toolEntries(["read", "powershell", "edit", "write"])),
    "default",
  );
  assert.equal(
    getPresetFromTools(toolEntries(["powershell", "read", "edit", "write", "grep", "find", "ls"])),
    "full",
  );
});

test("deriveToolNamesFromActive strips SDK extension-tool bloat from the live set", () => {
  const all = [...BUILTIN_NAMES, "Agent", "get_subagent_result", "web_search"];

  // SDK construction activates every extension tool; the derived preset must
  // come back as the plain default set without the host powershell tool.
  assert.deepEqual(
    deriveToolNamesFromActive(["read", "bash", "edit", "write", "powershell", "Agent", "get_subagent_result", "web_search"], all),
    PRESET_DEFAULT,
  );
  // Full preset survives the bloat.
  assert.deepEqual(
    deriveToolNamesFromActive(["bash", "read", "edit", "write", "grep", "find", "ls", "powershell", "Agent"], all),
    PRESET_FULL,
  );
  // Read-only preset survives the bloat.
  assert.deepEqual(
    deriveToolNamesFromActive(["read", "grep", "find", "ls", "Agent"], all),
    PRESET_READ_ONLY,
  );
  // PowerShell as the shell normalizes to bash before preset matching.
  assert.deepEqual(
    deriveToolNamesFromActive(["read", "powershell", "edit", "write", "Agent"], all),
    PRESET_DEFAULT,
  );
  // No active builtin tools (extension-only) derives the empty "none" set.
  assert.deepEqual(
    deriveToolNamesFromActive(["Agent", "web_search"], all),
    PRESET_NONE,
  );
  // Returns a fresh array each call.
  const names = deriveToolNamesFromActive(["read", "bash", "edit", "write"], all);
  names.push("custom");
  assert.deepEqual(deriveToolNamesFromActive(["read", "bash", "edit", "write"], all), PRESET_DEFAULT);
});
