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

test("RPC startup opens an existing session once and uses its canonical cwd", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  const commandRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const eventsRoute = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");

  assert.equal((startupSource.match(/SessionManager\.open\(/g) ?? []).length, 1);
  assert.match(startupSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(startupSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(startupSource, /cwd: sessionCwd/);
  assert.match(startupSource, /const hasExistingMessages = sessionManager\.getBranch\(\)\.some\(\(entry\) => entry\.type === "message"\)/);
  assert.match(startupSource, /const initial = hasExistingMessages/);
  assert.doesNotMatch(commandRoute, /SessionManager\.open\(/);
  assert.doesNotMatch(eventsRoute, /SessionManager\.open\(/);
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const deleteRouteSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const trustRouteSource = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");

  assert.match(source, /void this\.shutdown\(\)\.catch/);
  assert.match(source, /await this\.shutdown\(\)/);
  assert.match(deleteRouteSource, /await getRpcSession\(id\)\?\.shutdown\(\)/);
  assert.match(trustRouteSource, /await destroyRpcSessionsForCwd\(result\.cwd\)/);
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /persistExplicitStartupPreferences\(/);
  assert.match(startupSource, /modelDefaultChanged\) invalidateModelsCache\(\)/);
});
