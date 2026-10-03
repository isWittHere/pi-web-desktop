import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

// Settings › MCP is delivered on the shared SettingsUi template (ADR 0006 "Settings › MCP, without a
// session"). The other settings panels (Models, Skills, Plugins, Agents) keep their existing local
// presentation until they migrate to the shared template; this suite covers the template itself and the
// panel this task ships. The template/stylesheet assertions are upstream's, adapted to what is here.

const templateSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const mcpSource = await readFile(new URL("./McpConfig.tsx", import.meta.url), "utf8");

test("provides one template for config layout and controls", () => {
  for (const primitive of [
    "ConfigPanelShell",
    "ConfigSplitView",
    "ConfigSidebar",
    "ConfigSidebarGroupLabel",
    "ConfigSidebarGroupSwitch",
    "ConfigSidebarGroupStatus",
    "ConfigSidebarItem",
    "ConfigSidebarText",
    "ConfigDetail",
    "ConfigDetailStack",
    "ConfigDetailHeader",
    "ConfigDetailHeaderInfo",
    "ConfigDetailActions",
    "ConfigDetailTitle",
    "ConfigSectionTitle",
    "ConfigField",
    "ConfigEmptyState",
    "ConfigFooter",
    "ConfigButton",
    "ConfigSwitch",
    "ConfigListAction",
    "ConfigStatusDot",
    "ConfigScopeTag",
    "ConfigScopeSwitch",
    "ConfigSaveTarget",
    "ConfigAddSourceHeading",
    "ConfigAddSourcePanel",
    "ConfigDetailGrid",
    "ConfigDetailGridRow",
    "ConfigFooterStatus",
    "ConfigNotice",
    "ConfigTrustNotice",
  ]) {
    assert.match(templateSource, new RegExp(`export function ${primitive}`));
  }
  assert.match(templateSource, /className="config-sidebar"/);
  assert.match(templateSource, /className="config-detail"/);
  assert.match(cssSource, /\.config-sidebar \{[\s\S]*?width: 240px/);
  assert.match(cssSource, /\.config-detail \{[\s\S]*?padding: 20px/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.config-sidebar \{[\s\S]*?width: 100%/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.config-detail \{[\s\S]*?padding: 14px/);
});

test("loads settings presentation from its dedicated stylesheet", () => {
  assert.match(layoutSource, /import "\.\/globals\.css";\s*import "\.\/settings\.css";/);
  assert.match(cssSource, /\.config-panel-root \{/);
  assert.match(cssSource, /\.settings-dialog-backdrop \{/);
  assert.doesNotMatch(globalCssSource, /\.config-panel-root \{/);
  assert.doesNotMatch(globalCssSource, /\.settings-dialog-backdrop \{/);
});

test("the MCP panel uses the shared list-detail layout", () => {
  for (const primitive of ["ConfigPanelShell", "ConfigSplitView", "ConfigSidebar", "ConfigDetail", "ConfigFooter"]) {
    assert.match(mcpSource, new RegExp(`<${primitive}`), `McpConfig should use ${primitive}`);
  }
});

test("the MCP panel sidebar shares one typography scale", () => {
  assert.match(cssSource, /\.config-sidebar-text \{[\s\S]*?font-family: inherit[\s\S]*?font-size: 12px/);
  assert.match(cssSource, /\.config-sidebar-group-label \{[\s\S]*?font-family: inherit[\s\S]*?font-size: 10px/);
  assert.match(mcpSource, /<ConfigSidebarText/);
  assert.match(mcpSource, /<ConfigSidebarGroupLabel/);
});

test("shared config sidebar items use a fixed 30px height", () => {
  assert.match(cssSource, /\.config-sidebar-item \{[\s\S]*?height: 30px[\s\S]*?padding: 0 8px/);
  assert.match(cssSource, /\.config-list-action-button \{[\s\S]*?height: 30px[\s\S]*?min-height: 30px/);
});

test("the MCP detail pane shares one content hierarchy", () => {
  assert.match(cssSource, /\.config-detail-stack \{[\s\S]*?gap: 16px[\s\S]*?width: 100%/);
  assert.doesNotMatch(cssSource, /\.config-detail-stack \{[\s\S]*?max-width: 720px/);
  assert.match(cssSource, /\.config-field-label \{[\s\S]*?font-size: 11px/);
  assert.match(cssSource, /\.config-empty-state \{[\s\S]*?font-size: 12px/);
  assert.match(mcpSource, /<ConfigDetailStack/);
  assert.match(mcpSource, /<ConfigEmptyState/);
});

test("detail header actions keep buttons and switches aligned to the right", () => {
  assert.match(cssSource, /\.config-detail-actions \{[\s\S]*?justify-content: flex-end[\s\S]*?margin-left: auto/);
  assert.match(mcpSource, /<ConfigDetailActions>/);
});

test("keeps shared static presentation in the stylesheet", () => {
  assert.doesNotMatch(templateSource, /<style>/);
  assert.doesNotMatch(templateSource, /style=\{\{/);
  assert.doesNotMatch(templateSource, /onMouseEnter|onMouseLeave/);
  for (const className of [
    "config-panel-surface",
    "config-split-view",
    "config-sidebar-item",
    "config-detail-stack",
    "config-button",
    "config-switch",
    "config-scope-switch",
    "config-save-target",
    "config-detail-grid",
    "config-add-source-input",
    "config-add-source-example",
    "config-footer-status-list",
    "config-notice",
  ]) {
    assert.match(templateSource, new RegExp(className));
    assert.match(cssSource, new RegExp(`\\.${className}\\b`));
  }
});

test("every add pane chooses its scope in one place: the save target under its title", () => {
  // The Add pane (McpAddServer) holds the save target; the McpConfig container embeds it. The Code mode
  // choice in McpConfig is a segmented control of its own, not a scope save-target.
  const addPaneSource = readFileSync(new URL("./McpAddServer.tsx", import.meta.url), "utf8");
  assert.match(addPaneSource, /<ConfigSaveTarget[\s\S]*?label=\{t\("config\.saveTo"\)\}[\s\S]*?path=\{/);
  assert.doesNotMatch(addPaneSource, /<ConfigScopeSwitch/, "the add pane uses the shared row, not a switch of its own");
  assert.match(templateSource, /export function ConfigAddSourcePanel[\s\S]*?<ConfigAddSourceHeading/, "the add panel builds its heading from the same block");
  assert.match(cssSource, /\.config-save-target-path \{[\s\S]*?overflow-wrap: anywhere/);
  assert.doesNotMatch(cssSource, /config-add-source-location/);
});

test("the MCP panel's words come from the locale files, and its reasons are visible text", () => {
  for (const literal of [
    /Loading\.\.\./,
    /"(?:Global|Project|Code mode|Automatic|Always on|No servers)"/,
    />\s*(?:Global|Project|Code mode|Command|URL|Headers|Environment|Refresh)\s*</,
    /label="[A-Z][^"]*"/,
    /\{group\.scope\}</,
    /\{server\.scope\}</,
  ]) {
    assert.doesNotMatch(mcpSource, literal);
  }
  assert.match(mcpSource, /\{scopeLabel\(group\.scope, t\)\}/);
  assert.match(mcpSource, /<ConfigScopeTag scope=\{server\.scope\}>\{scopeLabel\(server\.scope, t\)\}<\/ConfigScopeTag>/);
  // Why a server does not connect is text on its row and in its accessible name, not only the dot, in the
  // words of whoever saw the state (a test, or an open session).
  assert.match(mcpSource, /aria-label=\{t\("mcp\.rowLabel", \{ name, state: t\(mcpRowStateLabelKey\(state, server\.status\)\) \}\)\}/);
  assert.match(mcpSource, /\{badgeKey && <span className=\{`mcp-sidebar-badge is-\$\{tone\}`\}>\{t\(badgeKey\)\}<\/span>\}/);
  // The panel's own title is the only one: no reason hides in a tooltip.
  assert.deepEqual(mcpSource.match(/\btitle=\{[^}]*\}/g), ['title={t("settings.mcp")}']);
  // The untrusted project's notice offers Trust (the page's trust dialog) through the shared block.
  assert.match(mcpSource, /<ConfigTrustNotice id=\{trustNoticeId\} message=\{trustMessage\} trustLabel=\{t\("mcp\.trust\.trustButton"\)\} onTrust=\{onTrust\} \/>/);
  // File problems open a list in the footer instead of a tooltip.
  assert.match(mcpSource, /<ConfigFooterStatus[\s\S]*?details=\{problems\.map\(/);
  for (const primitive of ["ConfigDetailGrid", "ConfigDetailGridRow", "ConfigScopeTag", "ConfigStatusDot", "ConfigNotice"]) {
    assert.match(mcpSource, new RegExp(`<${primitive}[ >]`), primitive);
  }
});

test("Settings › MCP switches whole groups from the heading too, and a disabled switch points at its reason", () => {
  // The n/m count became the group switch, in the heading row, with what it left undone under it.
  assert.match(mcpSource, /<ConfigSidebarGroupLabel\n\s*aside=\{total > 0 \? \(\n\s*<ConfigSidebarGroupSwitch/);
  assert.match(mcpSource, /<ConfigSidebarGroupStatus note=\{statusText\.note\} error=\{statusText\.error\} \/>/);
  // MCP passes its own on rule (entries the switch never turns on do not hold it off); the others keep every row on.
  assert.match(templateSource, /checked=\{checked \?\? \(total > 0 && enabled === total\)\}/);
  assert.match(mcpSource, /checked=\{checked\}/);
  assert.doesNotMatch(mcpSource, /className="sr-only"/);
  // Why a control cannot be used is visible text it is described by, never only a tooltip.
  assert.match(templateSource, /export function ConfigSwitch\(\{[\s\S]*?describedBy,[\s\S]*?aria-describedby=\{describedBy\}/);
  assert.match(templateSource, /export function ConfigSidebarGroupSwitch\(\{[\s\S]*?describedBy=\{describedBy\}/);
  assert.match(templateSource, /export function ConfigNotice\(\{ id, action, children \}[\s\S]*?<div id=\{id\} role="status"/);
  assert.match(templateSource, /export function ConfigTrustNotice\(\{\n\s*id,[\s\S]*?<ConfigNotice\n\s*id=\{id\}/);
  assert.match(mcpSource, /describedBy=\{block \? blockNoticeId : undefined\}/);
  assert.match(mcpSource, /<ConfigSwitch[\s\S]*?describedBy=\{note \? noteId : undefined\}/);
});
