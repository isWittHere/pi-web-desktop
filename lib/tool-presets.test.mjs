import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  CONFIGURED_TOOL_PRESET,
  PRESET_DEFAULT,
  PRESET_FULL,
  PRESET_NONE,
  PRESET_READ_ONLY,
  deriveToolPresetFromActive,
  getAllToolNamesForPreset,
  getToolNamesForPreset,
} = await jiti.import("./tool-presets.ts");

test("maps every tool preset to its built-in tools", () => {
  assert.deepEqual(getToolNamesForPreset("none"), PRESET_NONE);
  assert.deepEqual(getToolNamesForPreset("read-only"), PRESET_READ_ONLY);
  assert.deepEqual(getToolNamesForPreset("default"), PRESET_DEFAULT);
  assert.deepEqual(getToolNamesForPreset("full"), PRESET_FULL);
  assert.deepEqual(PRESET_READ_ONLY, ["read", "grep", "find", "ls"]);
});

test("the configured preset stands for \"no explicit override\"", () => {
  // Undefined is what makes callers omit toolNames, so pi resolves defaultTools (#700).
  assert.equal(getAllToolNamesForPreset(CONFIGURED_TOOL_PRESET), undefined);
  assert.equal(CONFIGURED_TOOL_PRESET, "configured");
  // Every concrete preset still resolves to a real tool list.
  for (const preset of ["none", "read-only", "default", "full"]) {
    assert.ok(Array.isArray(getAllToolNamesForPreset(preset)), preset);
  }
});

test("infers presets from active tool sets while ignoring active custom tools", () => {
  const customNames = ["web_search", "delegate"];

  assert.equal(deriveToolPresetFromActive([...customNames]), "none");
  assert.equal(
    deriveToolPresetFromActive([...PRESET_READ_ONLY, ...customNames]),
    "read-only",
  );
  assert.equal(
    deriveToolPresetFromActive([...PRESET_DEFAULT, ...customNames]),
    "default",
  );
  assert.equal(
    deriveToolPresetFromActive([...PRESET_FULL, ...customNames]),
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
    deriveToolPresetFromActive(["read", "powershell", "edit", "write"]),
    "default",
  );
  assert.equal(
    deriveToolPresetFromActive(["powershell", "read", "edit", "write", "grep", "find", "ls"]),
    "full",
  );
});

test("deriveToolPresetFromActive reports unmatched sets as custom, never default", () => {
  // Exact preset combinations are recognized (extension tools ignored).
  assert.equal(deriveToolPresetFromActive([...PRESET_READ_ONLY, "web_search"]), "read-only");
  assert.equal(deriveToolPresetFromActive([...PRESET_DEFAULT, "web_search"]), "default");
  assert.equal(deriveToolPresetFromActive([...PRESET_FULL, "web_search"]), "full");
  assert.equal(deriveToolPresetFromActive(["Agent", "web_search"]), "none");
  // PowerShell as the shell normalizes to bash before matching.
  assert.equal(deriveToolPresetFromActive(["read", "powershell", "edit", "write"]), "default");
  // A user-tailored defaultTools set (settings.json) is NOT a preset: report
  // it honestly instead of masquerading as "default".
  assert.equal(deriveToolPresetFromActive(["read", "bash", "edit", "write", "grep"]), "custom");
  assert.equal(deriveToolPresetFromActive(["read", "grep"]), "custom");
  assert.equal(deriveToolPresetFromActive(["bash"]), "custom");
});
