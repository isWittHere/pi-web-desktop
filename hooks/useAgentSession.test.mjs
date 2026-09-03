import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("keeps the session event stream open through the idle grace window", () => {
  const graceSource = source.slice(
    source.indexOf("const scheduleEventStreamClose"),
    source.indexOf("const finishPromptWithoutStream"),
  );
  const finishSource = source.slice(
    source.indexOf("const finishPromptWithoutStream"),
    source.indexOf("const waitForPromptSettlement"),
  );
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );
  const agentSettledSource = source.slice(
    source.indexOf('case "agent_settled"'),
    source.indexOf('case "prompt_done"'),
  );

  assert.match(source, /const EVENT_STREAM_IDLE_GRACE_MS = 30_000/);
  assert.match(graceSource, /setTimeout\(\(\) => void checkServerIdle\(\), EVENT_STREAM_IDLE_GRACE_MS\)/);
  assert.match(graceSource, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sid\)\}`\)/);
  assert.match(graceSource, /closeEvents\(\)/);
  assert.match(finishSource, /scheduleEventStreamClose\(sid\)/);
  assert.doesNotMatch(finishSource, /closeEvents\(\)/);
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.match(agentStartSource, /cancelEventStreamGrace\(\)/);
  assert.match(agentSettledSource, /scheduleEventStreamClose\(sid\)/);
});

test("delegates event stream readiness and reconnection to AgentEventConnection", () => {
  const connectionSource = source.slice(
    source.indexOf("if (!eventConnectionRef.current) {"),
    source.indexOf("const setToolPresetState"),
  );
  const ensureSource = source.slice(
    source.indexOf("const ensureEventsConnected"),
    source.indexOf("const maintainEventsConnected"),
  );
  const maintainSource = source.slice(
    source.indexOf("const maintainEventsConnected"),
    source.indexOf("// A different window can start this session"),
  );
  const crossTabSource = source.slice(
    source.indexOf("// A different window can start this session"),
    source.indexOf("const respondToExtensionUi"),
  );

  assert.match(source, /new AgentEventConnection\(\{/);
  assert.match(connectionSource, /shouldMaintain: \(sid\) => \(/);
  assert.match(connectionSource, /agentRunningRef\.current\s*\|\| eventStreamGraceActiveRef\.current\s*\|\| \(sessionPropIdRef\.current === sid && sessionRunningRef\.current\)/);
  assert.match(connectionSource, /readinessTimeoutMs: EVENT_STREAM_READY_TIMEOUT_MS/);
  assert.match(connectionSource, /reconnectDelayMs: EVENT_STREAM_RECONNECT_DELAY_MS/);
  assert.match(source, /const EVENT_STREAM_READY_TIMEOUT_MS = 60_000/);
  assert.match(ensureSource, /eventConnectionRef\.current!\.ensureConnected\(sid\)/);
  assert.match(maintainSource, /eventConnectionRef\.current!\.maintain\(sid\)/);
  assert.match(crossTabSource, /if \(!session\?\.id \|\| !sessionRunning\) return;[\s\S]*?maintainEventsConnected\(session\.id\)/);
  assert.doesNotMatch(source, /EVENT_STREAM_CONNECT_TIMEOUT_MS/);
  assert.doesNotMatch(source, /connectEvents\(/);
});

test("preserves desktop terminal provider error notices during agent_end", () => {
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );

  assert.match(agentEndSource, /event\.willRetry !== true/);
  assert.match(agentEndSource, /event\.messages as AgentMessage\[\]/);
  assert.match(agentEndSource, /message\.stopReason === "error" && message\.errorMessage/);
  assert.match(agentEndSource, /addNotice\(\{ type: "error", message: message\.errorMessage \}\)/);
});

test("prompt completion uses one settlement state machine", () => {
  const promptDoneSource = source.slice(
    source.indexOf('case "prompt_done"'),
    source.indexOf('case "prompt_error"'),
  );
  const sendSource = source.slice(
    source.indexOf("const handleSend = useCallback"),
    source.indexOf("const executeBash = useCallback"),
  );

  assert.match(promptDoneSource, /notifyPromptStage\(runId\)/);
  assert.match(promptDoneSource, /scheduleEventStreamClose\(sid\)/);
  assert.match(sendSource, /rpcPromptPendingRef\.current = true/);
  assert.match(sendSource, /if \(promptRequestStarted && sentSessionId\)/);
  assert.match(sendSource, /void waitForPromptSettlement\(sentSessionId, promptRunId\)/);
});

test("coalesces streaming message snapshots and drops stale queued updates", () => {
  const agentStartSource = source.slice(
    source.indexOf('case "agent_start"'),
    source.indexOf('case "agent_end"'),
  );
  const updatesSource = source.slice(
    source.indexOf('case "message_start"'),
    source.indexOf('case "tool_execution_start"'),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "agent_settled"'),
  );

  assert.match(source, /createStreamUpdateScheduler\(\(message\) => \{\s*dispatch\(\{ type: "update", message \}\)/s);
  assert.match(updatesSource, /queueStreamUpdate\(normalizeToolCalls\(msg as AgentMessage\)\)/);
  assert.doesNotMatch(updatesSource, /dispatch\(\{ type: "update"/);
  assert.match(agentStartSource, /resetStreamUpdates\(\)/);
  assert.match(agentEndSource, /resetStreamUpdates\(\)/);
  assert.match(updatesSource, /resetStreamUpdates\(\);\s*dispatch\(\{ type: "reset"/s);
});

test("shows the latest streamed tool execution progress in the running phase", async () => {
  const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const updateSource = source.slice(
    source.indexOf('case "tool_execution_update"'),
    source.indexOf('case "tool_execution_end"'),
  );

  assert.match(updateSource, /getToolExecutionProgress\(event\.partialResult\)/);
  assert.match(updateSource, /tools: \[\.\.\.tools\.filter\([\s\S]*?, updated\]/);
  assert.match(chatWindowSource, /if \(latest\?\.progress\)/);
  assert.match(chatWindowSource, /desktop\.runningToolProgress[\s\S]*latest\.progress/);
});

test("uses server pagination state instead of guessing from rendered rows", async () => {
  const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const loadContextSource = source.slice(
    source.indexOf("const loadContext = useCallback"),
    source.indexOf("const loadTools = useCallback"),
  );
  assert.match(source, /const \[hasEarlierMessages, setHasEarlierMessages\] = useState\(false\)/);
  assert.match(source, /setHasEarlierMessages\(d\.context\.hasMore\)/);
  assert.match(source, /setHistoryCursor\(d\.context\.oldestEntryId\)/);
  assert.match(loadContextSource, /setData\(\(prev\) => \{[\s\S]*messages: \[\.\.\.d\.context\.messages, \.\.\.prev\.context\.messages\]/);
  assert.match(chatWindowSource, /const oldestId = historyCursor/);
  assert.doesNotMatch(chatWindowSource, /const oldestId = entryIds\[0\]/);
  assert.match(chatWindowSource, /if \(!hasEarlierMessages\) return/);
  assert.match(chatWindowSource, /const hasMore = startIndex > 0 \|\| hasEarlierMessages/);
});

test("ChatWindow groups a headless leading run instead of the legacy renderer", async () => {
  const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  // A tail window that starts mid-turn (no user prompt in the window) must go
  // through the ProcessGroup path, not the flat legacy message renderer.
  assert.match(chatWindowSource, /idx === 0 && msg\.role !== "user" && !startsCompactionTurn/);
  assert.match(chatWindowSource, /key="headless-process-group"/);
  assert.match(chatWindowSource, /headlessEnd < messages\.length && messages\[headlessEnd\]\.role !== "user" && !isCompactionBoundary\(messages\[headlessEnd\]\)/);
});

test("scroll anchoring captures at prepend time and restores only after the DOM grows", async () => {
  const chatWindowSource = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const loadContextSource = source.slice(
    source.indexOf("const loadContext = useCallback"),
    source.indexOf("const loadTools = useCallback"),
  );
  // The anchor must be captured inside loadContext (post-fetch, pre-setState),
  // not at fetch start — otherwise user scrolling during the request goes stale.
  assert.match(loadContextSource, /opts\?\.captureAnchor\?\.\(\)/);
  assert.doesNotMatch(chatWindowSource, /loadingOlderRef\.current = true;\s*\n\s*prevScrollDistanceRef\.current = captureScrollDistance/);
  // The restore must wait until the grown window is actually in the DOM.
  assert.match(chatWindowSource, /prevScrollHeightRef\.current === container\.scrollHeight\) return/);
  // Anchors must not leak across sessions.
  assert.match(chatWindowSource, /prevScrollDistanceRef\.current = null;\s*\n\s*prevScrollHeightRef\.current = null;\s*\n\s*\}, \[session\?\.id\]\)/);
});
