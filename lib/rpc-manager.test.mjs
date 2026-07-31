import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RPC validates image arrays before sending prompt, steer, or follow-up commands", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const sendSource = source.slice(
    source.indexOf("  async send(command:"),
    source.indexOf("    switch (type) {", source.indexOf("  async send(command:")),
  );

  assert.match(sendSource, /type === "prompt" \|\| type === "steer" \|\| type === "follow_up"/);
  assert.match(sendSource, /validateAgentImages\(command\.images\)/);
});

test("custom extension UI receives the headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
  assert.match(customUiSource, /emitCustomUiRender/);
});

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});
