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
  // The window itself is the card: no border/container chrome, and its height
  // is computed from the number of content lines (title + detail rows) so it
  // never clips and never leaves dead space.
  const html = readFileSync(new URL("./notification-window.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /border:/);
  assert.match(html, /#head/);
  assert.match(html, /#logo/);
  assert.doesNotMatch(html, /Pi Agent/);
  assert.match(main, /detail\.split\("\\n"\)\.length/);
  assert.match(main, /contentLines \* 19 \+ 24/);
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
