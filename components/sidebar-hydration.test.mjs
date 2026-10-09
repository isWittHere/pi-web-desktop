import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

// The sidebar renders its session list through SessionSearch, whose children
// are always rendered (the overlay only replaces them once a query is active).
// A draft row therefore lands inside a time-group <div> — the exact node the
// Next hydration error pointed at (SessionSidebar.tsx:2037).
//
// renderToStaticMarkup never runs effects, which is precisely the hydration
// render: effects have not run yet. If a client-only data source (drafts) is
// already in state at that moment, the markup diverges from the server's.

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SessionSidebar } = await jiti.import("./SessionSidebar.tsx");
const { I18nContext } = await jiti.import("@/hooks/useI18n");
const { ContextMenuProvider } = await jiti.import("./ContextMenu.tsx");

const i18nValue = {
  locale: "en",
  setLocale() {},
  t: (key) => key,
  supportedLocales: [],
};

function renderWithDrafts(drafts) {
  return renderToStaticMarkup(
    React.createElement(
      I18nContext.Provider,
      { value: i18nValue },
      React.createElement(
        ContextMenuProvider,
        null,
        React.createElement(SessionSidebar, {
          selectedSessionId: null,
          onSelectSession() {},
          draftSessions: drafts,
        }),
      ),
    ),
  );
}

const draft = {
  id: "draft-1",
  cwd: "/tmp/proj",
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: new Date().toISOString(),
};

test("a draft in props at first render emits an extra session-list group", () => {
  const withoutDrafts = renderWithDrafts([]);
  const withDrafts = renderWithDrafts([draft]);
  // Both render the same "Loading..." placeholder (loading starts true), but
  // only the draft render adds the time-group wrapper around the draft row.
  assert.ok(withoutDrafts.includes("desktop.loading"), "server render shows the loading row");
  assert.ok(!withoutDrafts.includes("sidebar-time-group-header"), "no groups without rows");
  assert.ok(
    withDrafts.includes("sidebar-time-group-header"),
    "a draft present before effects produces the extra group <div>",
  );
  assert.notEqual(withDrafts, withoutDrafts);
});

test("AppShell does not seed draft state during the hydration render", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  // A lazy initializer runs during the hydration render (on the client it sees
  // localStorage), which is exactly what made the first client HTML contain a
  // draft row the server never rendered.
  assert.doesNotMatch(source, /useState<DraftSession\[\]>\(\(\) => loadDraftSessions\(\)\)/);
  assert.match(source, /useState<DraftSession\[\]>\(\[\]\)/);
  // Restoring + persisting must both happen after mount.
  assert.match(source, /setDraftSessions\(loadDraftSessions\(\)\s*\.filter\(/);
  assert.match(source, /if \(!draftsRestored\) return;[\s\S]*?saveDraftSessions\(draftSessions\)/);
});

test("drafts are not read during server render", async () => {
  const { loadDraftSessions } = await jiti.import("@/lib/draft-sessions.ts");
  const savedWindow = globalThis.window;
  try {
    globalThis.window = undefined;
    assert.deepEqual(loadDraftSessions(), []);
  } finally {
    globalThis.window = savedWindow;
  }
});
