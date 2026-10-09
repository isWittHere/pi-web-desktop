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
  assert.match(startupSource, /const hasExistingMessages = branch\.some\(\(entry\) => entry\.type === "message" && entry\.message\.role !== "system"\)/);
  // The single model decision point replaced the old two-branch restore: one
  // resolver decides from the recorded intent + explicit request + live scope.
  assert.match(startupSource, /const resolution = resolveSessionModel\(\{/);
  assert.match(startupSource, /recorded: savedModel/);
  assert.match(startupSource, /resolution\.status === "active" \? resolution\.model : resolution\.suggestion/);
  assert.doesNotMatch(startupSource, /selectInitialModelScope/);
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
  // The extension half now comes from the snapshot, so a resumed child keeps the
  // same `extensions:` scope it was spawned with (lib/subagents.ts).
  assert.match(startupSource, /\.\.\.subagentExtensionLoaderOptions\(subagentResources\)/);
  assert.match(startupSource, /noSkills: !subagentResources\.loadSkills/);
  assert.match(startupSource, /noContextFiles: true/);
  assert.match(startupSource, /excludeTools: \[\.\.\.SUBAGENT_CONTROL_TOOL_NAMES\]/);
  assert.match(startupSource, /toolsOption = subagentResources\.tools/);
  assert.match(startupSource, /subagentResources\.exactSystemPrompt/);
  assert.match(startupSource, /subagentResources\.appendSystemPrompt\[0\]/);

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

test("materialization resolves the active set from the persisted pin, the request, or the live state", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  // The persisted selection is read before the explicit request: reopening a
  // session restores the pin instead of the SDK's transcript-derived set.
  assert.match(startupSource, /const persistedToolNames = readSessionToolSelection\(branch/);
  assert.match(startupSource, /persistedToolNames \?\? \(toolNames !== undefined \? toolNames : undefined\)/);
  // The active set is resolved from the selection over the initial carry, not
  // forced to include every registered extension tool.
  assert.match(startupSource, /resolveActiveToolNames\(inner, selectedToolNames \?\? initialToolNames, initialToolNames\)/);
  // Subagent sessions skip the selection: their registry is allow-listed at
  // construction and their tool list is fixed by the profile.
  assert.match(startupSource, /if \(!subagentResources\) \{\s*const persistedToolNames/);
  // An empty selection still clears the system prompt.
  assert.match(startupSource, /selectionIsEmpty = inner\.getActiveToolNames\(\)\.length === 0/);
  assert.match(startupSource, /\} else if \(selectionIsEmpty\) \{/);
  assert.match(startupSource, /beginExtensionBinding\(\{ forceEmptySystemPrompt: selectionIsEmpty \}\)/);
});

test("resolveActiveToolNames replaces coding tools and carries live non-coding tools", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { resolveActiveToolNames } = await jiti.import("./rpc-manager.ts");

  const session = {
    settingsManager: { getDefaultTools: () => undefined },
    getAllTools: () => [
      { name: "read", description: "", exposure: "direct" },
      { name: "bash", description: "", exposure: "direct" },
      { name: "codemode", description: "", exposure: "codemode" },
      { name: "mcp-tool", description: "", exposure: "direct" },
      { name: "withdrawn", description: "", exposure: "hidden" },
    ],
    getActiveToolNames: () => ["read", "bash", "mcp-tool", "withdrawn"],
  };

  // Coding tools are replaced by the request; live non-coding tools stay; a
  // hidden tool is dropped even when it was active.
  assert.deepEqual(
    resolveActiveToolNames(session, ["read", "grep"], session.getActiveToolNames()),
    ["read", "grep", "mcp-tool"],
  );
  // Nothing is added on top: a non-coding tool that was never active stays off.
  assert.deepEqual(
    resolveActiveToolNames(session, ["read", "bash"], ["read"]),
    ["read", "bash"],
  );
  // An empty request disables every tool.
  assert.deepEqual(resolveActiveToolNames(session, [], session.getActiveToolNames()), []);
});

test("resolveActiveToolNames swaps the shell tool per the PowerShell setting", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { resolveActiveToolNames } = await jiti.import("./rpc-manager.ts");

  const session = {
    settingsManager: { getDefaultTools: () => ["read", "powershell"] },
    getAllTools: () => [
      { name: "read", description: "", exposure: "direct" },
      { name: "bash", description: "", exposure: "direct" },
      { name: "powershell", description: "", exposure: "direct" },
    ],
    getActiveToolNames: () => ["read", "bash"],
  };
  assert.deepEqual(
    resolveActiveToolNames(session, ["read", "bash"], session.getActiveToolNames()),
    ["read", "powershell"],
  );
});

test("reload re-applies the pinned tool selection for non-subagent sessions", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const reloadSource = source.slice(
    source.indexOf('case "reload"'),
    source.indexOf('case "abort_compaction"'),
  );

  // reload() rebuilds the registry with includeAllExtensionTools and keeps the
  // previous active set; re-apply the pin (or the settings resolution when no
  // pin is set) so a PowerShell toggle cannot leave both shell tools active.
  assert.match(reloadSource, /await this\.inner\.reload\(\);/);
  assert.match(reloadSource, /readSubagentSessionResources\(/);
  assert.match(reloadSource, /pinnedToolNames\(this\.inner\) \?\? configuredToolNames\(this\.inner\)/);
});

test("set_tools persists the pin and the retraction, and navigations replay the pin", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const setToolsSource = source.slice(
    source.indexOf('case "set_tools"'),
    source.indexOf('case "reload"'),
  );

  // A concrete selection is persisted before it is applied.
  assert.match(setToolsSource, /appendSessionToolSelection\(this\.inner\.sessionManager, toolNames\)/);
  assert.match(setToolsSource, /this\.setActiveToolSelection\(toolNames\)/);
  // Retracting the selection clears the pin on disk and re-resolves the
  // settings defaults instead of replaying an older pin.
  assert.match(setToolsSource, /appendClearedSessionToolSelection\(this\.inner\.sessionManager\)/);
  assert.match(setToolsSource, /configuredToolNames\(this\.inner\)/);

  // navigate_tree re-applies the pin after the SDK restored the branch's
  // transcript-declared loadout, and retracts cleanly when none is pinned.
  assert.match(source, /navigateTreeKeepingToolSelection\(command\.targetId as string/);
  const helperSource = source.slice(
    source.indexOf("private async navigateTreeKeepingToolSelection"),
    source.indexOf("  onEvent(listener"),
  );
  assert.match(helperSource, /pinnedToolNames\(this\.inner\) \?\? carry/);
});

test("get_tools hides withdrawn tools and reports exposure", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const getToolsSource = source.slice(
    source.indexOf('case "get_tools"'),
    source.indexOf('case "get_commands"'),
  );

  // A hidden tool is withdrawn: not callable, not togglable, not listed.
  assert.match(getToolsSource, /getAllTools\(\)\.filter\(\(t\) => t\.exposure !== "hidden"\)/);
  assert.match(getToolsSource, /exposure: t\.exposure/);
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

test("a listener that unsubscribes while handling an event does not hide it from the next one", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

  const inner = {
    sessionId: "test-session",
    sessionFile: undefined,
    isBashRunning: false,
    abortBash() {},
    dispose() {},
    extensionRunner: {},
  };
  const wrapper = new AgentSessionWrapper(inner, "/tmp");
  const received = [];
  const stopFirst = wrapper.onEvent((event) => {
    received.push(["first", event.type]);
    stopFirst();
  });
  wrapper.onEvent((event) => received.push(["second", event.type]));
  wrapper.onEvent((event) => received.push(["third", event.type]));

  wrapper.destroy();

  assert.deepEqual(received, [
    ["first", "session_shutdown"],
    ["second", "session_shutdown"],
    ["third", "session_shutdown"],
  ]);
});
