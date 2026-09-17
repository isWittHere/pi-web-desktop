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
  assert.match(startupSource, /const branch = sessionManager\.getBranch\(\)/);
  assert.match(startupSource, /const hasExistingMessages = branch\.some\(\(entry\) => entry\.type === "message"\)/);
  assert.match(startupSource, /const initial = hasExistingMessages \? null : selectInitialModelScope\(scope, \{/);
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

test("persisted subagent sessions restore their isolated resource snapshot", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const runtimeSource = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /readSubagentSessionResources\(/);
  assert.match(startupSource, /resourceLoaderOptions: subagentResources/);
  assert.match(startupSource, /appendSystemPrompt: subagentResources\.appendSystemPrompt/);
  assert.match(startupSource, /noExtensions: !subagentResources\.loadExtensions/);
  assert.match(startupSource, /noSkills: !subagentResources\.loadSkills/);
  assert.match(startupSource, /noContextFiles: true/);
  assert.match(startupSource, /excludeTools: \[\.\.\.SUBAGENT_CONTROL_TOOL_NAMES\]/);
  assert.match(startupSource, /toolsOption = subagentResources\.tools/);
  assert.match(startupSource, /setExactSystemPrompt\(\(\) => subagentResources\.appendSystemPrompt\[0\]/);

  assert.match(runtimeSource, /SessionManager\.create\(parent\.cwd, undefined, \{ parentSession: parent\.sessionFile \}\)/);
  assert.match(runtimeSource, /appendCustomEntry\(SUBAGENT_META_TYPE/);
  assert.match(runtimeSource, /appendCustomEntry\(SUBAGENT_RESULT_TYPE/);
  assert.match(runtimeSource, /excludeTools: \[\.\.\.SUBAGENT_CONTROL_TOOL_NAMES\]/);
  assert.match(runtimeSource, /resourceSnapshot:/);
});

test("subagent tool selection stays fixed to the profile snapshot", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const setToolsSource = source.slice(
    source.indexOf('case "set_tools"'),
    source.indexOf('case "reload"'),
  );

  assert.match(setToolsSource, /readSubagentSessionResources\(/);
  assert.match(setToolsSource, /Subagent tool selection is fixed by its profile/);
  assert.match(source, /createSubagentController\(/);
  assert.match(source, /createSubagentExtension\(\s*SUBAGENT_CONTROLLER\.extensionRuntime,/);
  assert.match(source, /preferPiWebSubagentExtension\(base\)/);
});

test("replays live shell tool events to reconnected SSE listeners", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const subscribeSource = source.slice(
    source.indexOf("this.unsubscribe = this.inner.subscribe"),
    source.indexOf("setForceEmptySystemPrompt"),
  );
  const onEventSource = source.slice(
    source.indexOf("  onEvent(listener: EventListener): () => void {"),
    source.indexOf("  onDestroy(cb: () => void): void {"),
  );
  const destroySource = source.slice(
    source.indexOf("  destroy(): void {"),
    source.indexOf("  async shutdown"),
  );

  // The wrapper keeps a Map of in-flight tool events keyed by toolCallId.
  assert.match(source, /private activeToolEvents = new Map<string, AgentEvent>\(\)/);
  // start/update set, end removes.
  assert.match(subscribeSource, /tool_execution_start" \|\| event\.type === "tool_execution_update"/);
  assert.match(subscribeSource, /this\.activeToolEvents\.set\(toolCallId, event\)/);
  assert.match(subscribeSource, /this\.activeToolEvents\.delete\(toolCallId\)/);
  // New SSE listeners replay cached events so reconnected streams get the output.
  assert.match(onEventSource, /for \(const event of this\.activeToolEvents\.values\(\)\) listener\(event\);/);
  // destroy clears the cache.
  assert.match(destroySource, /this\.activeToolEvents\.clear\(\)/);
});

test("persists a first-message fork that createBranchedSession deferred", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const forkSource = source.slice(
    source.indexOf('case "fork"'),
    source.indexOf('case "navigate_tree"'),
  );

  // Reuse a single forkedManager so the SDK's in-place mutation updates its id/file.
  assert.match(forkSource, /let forkedManager: SessionManager/);
  // First-message fork creates an empty session linked to the current file.
  assert.match(forkSource, /SessionManager\.create\(sessionManager\.getCwd\(\), sessionDir, \{\s*parentSession: currentSessionFile,\s*\}\)/s);
  // History fork copies the branch up to the fork point.
  assert.match(forkSource, /forkedManager\.createBranchedSession\(entry\.parentId\)/);
  // If the file was never written, persist header + entries immediately.
  assert.match(forkSource, /existsSync\(newSessionFile\)/);
  assert.match(forkSource, /\[forkedHeader, \.\.\.forkedManager\.getEntries\(\)\]/);
  assert.match(forkSource, /writeFileSync\(newSessionFile, content, \{ encoding: "utf8", flag: "wx" \}\)/);
  // The new id comes from the mutated manager, not a fresh reopen.
  assert.match(forkSource, /const newSessionId = forkedManager\.getSessionId\(\)/);
});
