import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { packagesToSwitch, filteredPackagesKeptOn } = await jiti.import("./PluginsConfig.tsx");

const pkg = (source, scope, disabled, filtered) => ({ source, scope, disabled, filtered });

test("packagesToSwitch returns the packages a bulk switch would change", () => {
  const packages = [
    pkg("a", "global", false, false),
    pkg("b", "global", true, false),
    pkg("c", "project", false, false),
  ];
  assert.deepEqual(packagesToSwitch(packages, true).map((p) => p.source), ["b"]);
  assert.deepEqual(packagesToSwitch(packages, false).map((p) => p.source), ["a", "c"]);
});

test("Disable all leaves an enabled filtered package on", () => {
  const packages = [
    pkg("plain", "global", false, false),
    pkg("filtered", "global", false, true),
    pkg("already-off", "global", true, false),
  ];
  assert.deepEqual(packagesToSwitch(packages, false).map((p) => p.source), ["plain"]);
  // Enable all still turns the disabled one on; filters are not a reason to skip.
  assert.deepEqual(packagesToSwitch(packages, true).map((p) => p.source), ["already-off"]);
});

test("filteredPackagesKeptOn names the enabled filtered packages", () => {
  const packages = [
    pkg("plain", "global", false, false),
    pkg("filtered", "global", false, true),
    pkg("off-filtered", "global", true, true),
  ];
  assert.deepEqual(filteredPackagesKeptOn(packages).map((p) => p.source), ["filtered"]);
});
