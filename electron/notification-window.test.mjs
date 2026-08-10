import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");

test("notification window loads its HTML on creation", () => {
  // Regression: the popup window used to be created with listeners attached
  // but loadFile was never called, so did-finish-load never fired and the
  // popup never appeared. The load must happen inside ensureNotificationWindow.
  const ensureBlock = main.slice(main.indexOf("function ensureNotificationWindow"), main.indexOf("function showScreenNotification"));
  assert.match(ensureBlock, /loadFile\(path\.join\(__dirname, "notification-window\.html"\)\)/);
});

test("notification popup does not use focusable:false with transparent:true", () => {
  // Windows: focusable:false + transparent always-on-top windows can fail to
  // paint entirely. Guard the combination away so it cannot regress. The
  // options object must not contain a focusable:false property (the comment
  // above legitimately mentions the combination, so match the property only).
  const optsBlock = main.slice(main.indexOf("new BrowserWindow({"), main.indexOf("setAlwaysOnTop(true, \"screen-saver\")"));
  assert.doesNotMatch(optsBlock, /\n\s*focusable:\s*false/);
  assert.match(optsBlock, /\n\s*transparent:\s*false/);
  assert.match(main, /setBackgroundColor/);
});

test("notification popup suppress logic requires visible AND focused", () => {
  // Hidden-to-tray windows (visible=false) must always notify. The check is
  // split across lines (mainVisible + mainFocused vars), so assert on the
  // combined suppression condition.
  assert.match(main, /mainVisible && mainFocused/);
});

test("suppression also requires the finished session to be the open one", () => {
  // The card is only suppressed when the user is watching the conversation
  // that finished: window visible+focused AND sessionId === focusedSessionId.
  // Background completions (any other session) must always notify.
  assert.match(main, /sessionId === payload\.focusedSessionId/);
  assert.match(main, /isFocusedSession/);
  assert.match(main, /mainVisible && mainFocused && isFocusedSession/);
  // The renderer reports the open session id on every show request.
  const shell = readFileSync(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /focusedSessionId: selectedSession\?\.id/);
  const hook = readFileSync(new URL("../hooks/useNotifications.ts", import.meta.url), "utf8");
  assert.match(hook, /focusedSessionId: payload\.focusedSessionId/);
});

test("fallback polling skips while the main window is focused", () => {
  // The poll exists for frozen/hidden renderers. While the window is visible
  // and focused the renderer drives notifications itself, so the poll must
  // not fire a stale fallback card for the session the user is watching.
  assert.match(main, /mainWindow\.isVisible\(\) && mainWindow\.isFocused\(\)/);
  const pollBlock = main.slice(main.indexOf("async function pollRunningSessions"), main.indexOf("async function notifyFinishedSession"));
  assert.match(pollBlock, /knownRunningSessionIds = new Set\(\);/);
});

test("notification popup pauses auto-hide while hovered", () => {
  // Hover must cancel the auto-hide timer and leave must restart it, so the
  // card stays readable while the mouse is over it.
  assert.match(main, /ipcMain\.on\("notification:hover"/);
  assert.match(main, /notificationHovered/);
  assert.match(main, /if \(!notificationHovered\) scheduleNotificationHide\(\)/);
  assert.match(main, /cancelNotificationHide\(\)/);
  assert.match(main, /scheduleNotificationHide\(\)/);
});

test("main window disables background throttling for hidden-tray runs", () => {
  // A hidden (tray) renderer is throttled by default: timers freeze and SSE
  // events pile up, so a background completion is only noticed when the
  // window is shown again. Completion notifications require the renderer to
  // keep processing while hidden.
  assert.match(main, /backgroundThrottling: false/);
});

test("notification popup card is borderless and height adapts to content", () => {
  // The window itself is the card: no border/container chrome on #card, and
  // its height is computed from the number of content lines (title + detail
  // rows) so it never clips and never leaves dead space. The dismiss (×)
  // button is required too.
  const html = readFileSync(new URL("./notification-window.html", import.meta.url), "utf8");
  const cardBlock = html.slice(html.indexOf("#card {"), html.indexOf("#head {"));
  assert.doesNotMatch(cardBlock, /border:/);
  assert.match(html, /#head/);
  assert.match(html, /#logo/);
  assert.doesNotMatch(html, /Pi Agent/);
  assert.match(html, /#dismiss/);
  assert.match(main, /detail\.split\("\\n"\)\.length/);
  assert.match(main, /contentLines \* 19 \+ 24/);
});

test("notification duration setting flows to the main process", () => {
  // The chat setting (localStorage pi-notification-duration) is sent with each
  // popup request; "forever" disables auto-hide, numeric values set seconds.
  assert.match(main, /notificationDurationMs/);
  assert.match(main, /payload\.duration === "forever"/);
  assert.match(main, /Number\.isFinite\(secs\)/);
  assert.match(main, /ipcMain\.on\("notification:dismiss"/);
  const hook = readFileSync(new URL("../hooks/useNotifications.ts", import.meta.url), "utf8");
  assert.match(hook, /duration: getStoredNotificationDuration\(\)/);
});

test("main process polls running sessions as a completion fallback", () => {
  // A frozen hidden renderer misses agent_end, so the popup must not depend
  // on it alone. The main process polls /api/agent/running, skips sessions the
  // renderer already reported, and notifies the rest from /api/sessions/[id].
  assert.match(main, /pollRunningSessions/);
  assert.match(main, /\/api\/agent\/running/);
  assert.match(main, /recentlyNotifiedSessions/);
  assert.match(main, /notifyFinishedSession/);
  assert.match(main, /startCompletionPolling\(\)/);
  assert.match(main, /setInterval\(pollRunningSessions, 3000\)/);
});

test("notification card click navigates to the finished session", () => {
  // Clicking the card must raise the main window AND ask the renderer to
  // select the session that finished. The sessionId is carried end to end:
  // renderer -> showScreenNotification data -> popup -> clicked IPC -> main
  // window navigate event -> SessionSidebar selects it.
  const showBlock = main.slice(main.indexOf("ipcMain.handle(\"notification:show\""), main.indexOf("ipcMain.on(\"notification:dismiss\""));
  assert.match(showBlock, /sessionId: typeof payload\.sessionId/);
  assert.match(main, /notification:navigate/);
  assert.match(main, /mainWindow\.webContents\.send\("notification:navigate", sessionId\)/);
  const html = readFileSync(new URL("./notification-window.html", import.meta.url), "utf8");
  assert.match(html, /currentSessionId/);
  assert.match(html, /onClicked\(currentSessionId\)/);
  const preload = readFileSync(new URL("./preload.js", import.meta.url), "utf8");
  assert.match(preload, /onClicked: \(sessionId\)/);
  assert.match(preload, /notification:navigate/);
  // The sidebar resolves the id back to a SessionInfo and selects it.
  const sidebar = readFileSync(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /onNotificationNavigate/);
  assert.match(sidebar, /onSelectSessionRef\.current\?\.\(session\)/);
});

test("fallback card carries session id and cleans skill XML titles", () => {
  // The main-process fallback must mark the session handled (so a renderer
  // notifyDone right after is suppressed by the repeat guard) and collapse
  // SDK-expanded <skill> blocks in the title like the session list does. It
  // also fills model + $cost detail lines from the session stats so the card
  // is as informative as the renderer's own.
  assert.match(main, /NOTIFICATION_REPEAT_GUARD_MS/);
  assert.match(main, /recentlyNotifiedSessions\.set\(sessionId, Date\.now\(\)\)/);
  assert.match(main, /cleanSessionTitle\(/);
  assert.match(main, /name="\(\[\^\"\]\+\)"/);
  assert.match(main, /stats\?\.model\?\.modelId/);
  assert.match(main, /stats\.cost >= 0\.01/);
  // Renderer path applies the same cleanup via lib/skill-block.
  const shell = readFileSync(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /getSessionDisplayFirstMessage\(session\.firstMessage\)/);
});
