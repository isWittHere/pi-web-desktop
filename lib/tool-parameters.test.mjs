import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getToolParameterFields } = await jiti.import("./tool-parameters.ts");

test("extracts required and optional scalar fields from a TypeBox-like object schema", () => {
  const fields = getToolParameterFields({
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string", description: "The command to run" },
      timeout: { type: "number", default: 30 },
    },
  });
  assert.deepEqual(fields, [
    { name: "command", type: "string", required: true, description: "The command to run" },
    { name: "timeout", type: "number", required: false, defaultValue: 30 },
  ]);
});

test("surfaces enum, union, nullable and nested-object types", () => {
  const fields = getToolParameterFields({
    type: "object",
    properties: {
      mode: { anyOf: [{ type: "string", const: "read" }, { type: "string", const: "write" }] },
      mayBeNull: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "number" } },
      config: { type: "object", required: ["verbose"], properties: { verbose: { type: "boolean" } } },
      pick: { enum: ["a", "b", "c"] },
    },
  });
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  assert.equal(byName.mode.type, '"read" | "write"');
  assert.equal(byName.mayBeNull.type, "string?");
  assert.equal(byName.tags.type, "Array<number>");
  assert.equal(byName.config.type, "object");
  assert.equal(byName.pick.type, "enum<3>");
  assert.deepEqual(byName.pick.enumValues, ["a", "b", "c"]);
});

test("collapses a single-null union branch into a nullable type", () => {
  const fields = getToolParameterFields({
    type: "object",
    properties: {
      maybe: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
  });
  assert.equal(fields[0].type, "string?");
});

test("returns an empty list for missing or non-object schemas", () => {
  assert.deepEqual(getToolParameterFields(undefined), []);
  assert.deepEqual(getToolParameterFields({ type: "string" }), []);
  assert.deepEqual(getToolParameterFields({ type: "object" }), []);
});