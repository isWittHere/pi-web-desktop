import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
const enMessages = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhMessages = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("provides a debounced file search UI and opens selected results", () => {
  assert.match(source, /searchQuery/);
  assert.match(source, /\/api\/file-index\?cwd=\$\{encodeURIComponent\(cwd\)\}&q=\$\{encodeURIComponent\(query\)\}/);
  assert.match(source, /setTimeout\(\(\) =>/);
  assert.match(source, /onOpenFile\(node\.fullPath, node\.name\)/);
});

test("renders search results with the existing expandable file tree", () => {
  assert.match(source, /buildSearchTree/);
  assert.match(source, /searchRoots\.map/);
  assert.match(source, /<TreeNode/);
  assert.match(source, /expandedPaths=\{searchExpanded\}/);
});

test("search result rows offer mention and download actions like the file tree", () => {
  assert.match(source, /onAtMention\(getRelativeFilePath\(node\.fullPath, cwd\), node\.isDir\)/);
  assert.match(source, /<MentionIcon \/>/);
  assert.match(source, /encodeFilePathForApi\(node\.fullPath\)\}\?type=download/);
});

test("keeps search on the bounded index and reports request failures", () => {
  assert.match(source, /setSearchError\(true\)/);
  assert.match(source, /role="alert"/);
  assert.doesNotMatch(apiSource, /type === "search"|searchFiles/);
});

test("toggles the search panel from the explorer toolbar", () => {
  assert.match(sidebarSource, /fileSearchOpen/);
  assert.match(sidebarSource, /setFileSearchOpen\(\(open\) => !open\)/);
  assert.match(sidebarSource, /fileSearchOpen=\{fileSearchOpen\}/);
  assert.match(sidebarSource, /onFileSearchOpenChange=\{setFileSearchOpen\}/);
});

test("adds matching en and zh-CN search strings under the desktop namespace", () => {
  for (const key of [
    "desktop.searchFiles",
    "desktop.searchFilesPlaceholder",
    "desktop.searchingFiles",
    "desktop.noMatchingFiles",
    "desktop.clearSearch",
    "desktop.fileSearchFailed",
  ]) {
    assert.match(enMessages, new RegExp(`"${key}"`));
    assert.match(zhMessages, new RegExp(`"${key}"`));
  }
});

test("session search stays a dedicated top row instead of replacing the header", () => {
  // The sessions header is always rendered; the search input lives in its
  // own pinned row between the header and the session list.
  assert.match(sidebarSource, /\{\/\* Header \*\//);
  assert.match(sidebarSource, /\{\/\* Session search row/);
  assert.match(sidebarSource, /\{sessionsOpen && searchOpen && \(/);
  assert.doesNotMatch(sidebarSource, /searchOpen \? \(/);
  assert.doesNotMatch(sidebarSource, /desktop\.exitSearch/);
});

test("session search matches the file search panel style and interaction", () => {
  // Toggle from the header magnifier (active highlight), same input styling
  // (border/bg/radius-5/11px mono), clear button, and Escape closes directly.
  assert.match(sidebarSource, /aria-pressed=\{searchOpen\}/);
  assert.match(sidebarSource, /searchOpen \? "var\(--accent\)" : "var\(--text-dim\)"/);
  assert.match(sidebarSource, /border: "1px solid var\(--border\)", borderRadius: 5/);
  assert.match(sidebarSource, /fontSize: 11/);
  assert.match(sidebarSource, /desktop\.clearSearch/);
});

test("session search is single-semantics: closing clears the query", () => {
  // Escape and the header toggle both clear the search text on close, so the
  // list always returns to the full (mark-filtered) view — no hidden title
  // quick-filter state. The removed quick-filter branch must not reappear.
  assert.match(sidebarSource, /if \(e\.key === "Escape"\) \{ setSearchOpen\(false\); setSessionSearch\(""\); \}/);
  assert.match(sidebarSource, /if \(searchOpen\) \{\s*setSearchOpen\(false\);\s*setSessionSearch\(""\);\s*\} else \{\s*setSearchOpen\(true\);\s*\}/);
  assert.match(sidebarSource, /buildSessionTree\(markFilteredSessions\)/);
  assert.doesNotMatch(sidebarSource, /searchScopedSessions/);
  assert.doesNotMatch(sidebarSource, /searchQuery = sessionSearch/);
});

test("full-text search is scoped to the selected project like the sidebar list", async () => {
  // The sidebar passes its resolved project root; the overlay forwards it and
  // the route filters the shared catalog by the same workspace key.
  assert.match(sidebarSource, /<SessionSearch open=\{searchOpen\} query=\{sessionSearch\} project=\{selectedProject\}/);
  const searchComponent = await readFile(new URL("./SessionSearch.tsx", import.meta.url), "utf8");
  assert.match(searchComponent, /project\?: string \| null/);
  assert.match(searchComponent, /\.\.\.\(project \? \{ project \} : \{\}\)/);
  const routeSource = await readFile(new URL("../app/api/sessions/search/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /url\.searchParams\.get\("project"\)/);
  assert.match(routeSource, /samePath\(workspaceKeyOf\(s\), project\)/);
});
