import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  TOOL_SELECTION_TYPE,
  appendClearedSessionToolSelection,
  appendSessionToolSelection,
  readSessionToolSelection,
  validateSessionToolSelection,
} = await createJiti(import.meta.url).import("./session-tool-selection.ts");

/** Minimal fake session entries: only what readSessionToolSelection looks at. */
function customEntry(data, overrides = {}) {
  return {
    type: "custom",
    customType: TOOL_SELECTION_TYPE,
    id: overrides.id ?? `e${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    data,
  };
}

function otherEntry(id) {
  return { type: "session_info", id, parentId: null, timestamp: new Date().toISOString(), name: "x" };
}

test("the latest valid selection wins over older ones", () => {
  const entries = [
    otherEntry("a"),
    customEntry({ toolNames: ["read", "bash"] }),
    otherEntry("b"),
    customEntry({ toolNames: ["read", "grep", "find", "ls"] }),
  ];
  assert.deepEqual(readSessionToolSelection(entries), ["read", "grep", "find", "ls"]);
});

test("a cleared entry retracts an earlier selection", () => {
  const entries = [
    customEntry({ toolNames: ["read", "bash"] }),
    customEntry({ cleared: true }),
  ];
  assert.equal(readSessionToolSelection(entries), undefined);
});

test("a selection after a cleared entry is the pin again", () => {
  const entries = [
    customEntry({ cleared: true }),
    customEntry({ toolNames: ["read"] }),
  ];
  assert.deepEqual(readSessionToolSelection(entries), ["read"]);
});

test("invalid selection data is ignored, not treated as a pin or a clear", () => {
  const entries = [
    customEntry({ toolNames: "read" }),
    customEntry({ toolNames: ["read", "not-a-tool"] }),
    customEntry(null),
    customEntry({ toolNames: [42] }),
    customEntry({ toolNames: ["read", "bash"] }),
  ];
  assert.deepEqual(readSessionToolSelection(entries), ["read", "bash"]);
});

test("a file without selection entries returns undefined", () => {
  assert.equal(readSessionToolSelection([otherEntry("a"), otherEntry("b")]), undefined);
  assert.equal(readSessionToolSelection([]), undefined);
});

test("validateSessionToolSelection accepts builtin names only", () => {
  assert.deepEqual(validateSessionToolSelection({ toolNames: ["read", "bash", "powershell"] }), ["read", "bash", "powershell"]);
  assert.equal(validateSessionToolSelection({ toolNames: ["Agent"] }), undefined);
  assert.deepEqual(validateSessionToolSelection({ toolNames: [] }), []);
  assert.equal(validateSessionToolSelection(undefined), undefined);
  assert.equal(validateSessionToolSelection("read"), undefined);
});

test("appenders write the expected custom entry payloads", () => {
  const appended = [];
  const sessionManager = {
    appendCustomEntry: (customType, data) => {
      appended.push({ customType, data });
      return `id-${appended.length}`;
    },
  };
  appendSessionToolSelection(sessionManager, ["read", "bash"]);
  appendClearedSessionToolSelection(sessionManager);
  assert.deepEqual(appended, [
    { customType: TOOL_SELECTION_TYPE, data: { toolNames: ["read", "bash"] } },
    { customType: TOOL_SELECTION_TYPE, data: { cleared: true } },
  ]);
  // Round-trip: what the appenders write, the reader accepts.
  assert.deepEqual(readSessionToolSelection([customEntry(appended[0].data)]), ["read", "bash"]);
  assert.equal(readSessionToolSelection([customEntry(appended[1].data)]), undefined);
});
