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
