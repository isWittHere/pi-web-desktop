import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { buildSlashCommandLayout } = await jiti.import("./ChatInput.tsx");

test("uses the rendered slash command order for selection indices", () => {
  const layout = buildSlashCommandLayout([
    { name: "skill:alpha", description: "Dormant", source: "skill" },
    { name: "skill:beta", description: "Active", source: "skill" },
    { name: "compact", description: "Compact", source: "builtin" },
  ], { alpha: true, beta: false });

  assert.deepEqual(
    layout.commands.map((command) => command.name),
    ["compact", "skill:beta", "skill:alpha"],
  );
  assert.deepEqual(
    layout.groups.flatMap((group) => group.items.map((item) => item.index)),
    [0, 1, 2],
  );
});
