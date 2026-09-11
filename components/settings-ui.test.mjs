import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SettingsChipGroup, sidebarGroupStyle } = await jiti.import("./settings-ui.tsx");

function readComponent(name) {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

function render(props) {
  return renderToStaticMarkup(React.createElement(SettingsChipGroup, props));
}

// Regression: the switches carried no visible text — the label prop only fed
// aria-label/title — so the tool and resource rows rendered as bare pills.

test("renders every chip label as visible text", () => {
  const html = render({
    options: [
      { value: "read", label: "read" },
      { value: "bash", label: "bash" },
    ],
    selected: ["read"],
    onToggle() {},
  });
  assert.match(html, />read</);
  assert.match(html, />bash</);
});

test("exposes selection through aria-pressed and the group name", () => {
  const html = render({
    label: "Tools",
    options: [
      { value: "read", label: "read" },
      { value: "bash", label: "bash" },
    ],
    selected: ["bash"],
    onToggle() {},
  });
  assert.match(html, /role="group"/);
  assert.match(html, /aria-label="Tools"/);
  assert.match(html, /aria-pressed="true"[^>]*>bash</);
  assert.match(html, /aria-pressed="false"[^>]*>read</);
});

test("uses the mono face only for chips that opt in", () => {
  const mono = render({ options: [{ value: "read", label: "read" }], selected: [], onToggle() {}, mono: true });
  assert.match(mono, /font-family:var\(--font-mono\)/);
  const plain = render({ options: [{ value: "skills", label: "skills" }], selected: [], onToggle() {} });
  assert.doesNotMatch(plain, /font-family:var\(--font-mono\)/);
});

test("marks disabled chips so the checked state stays readable", () => {
  const html = render({ options: [{ value: "read", label: "read" }], selected: ["read"], onToggle() {}, disabled: true });
  assert.match(html, /disabled/);
  assert.match(html, /opacity:0\.5/);
});

test("falls back to the label for the hover title", () => {
  const html = render({
    options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", title: "Beta hint" }],
    selected: [],
    onToggle() {},
  });
  assert.match(html, /title="Alpha"/);
  assert.match(html, /title="Beta hint"/);
});

// Regression: the agents sidebar pinned a bordered header block (master
// switch + description) above the list while skills/plugins/models used the
// plain list + footer shape, so the column jumped when switching pages.

test("every manager sidebar builds its group headers from the shared style", () => {
  assert.equal(sidebarGroupStyle.padding, "4px 8px 3px");
  assert.equal(sidebarGroupStyle.fontSize, 10);
  assert.equal(sidebarGroupStyle.fontWeight, 600);
  assert.equal(sidebarGroupStyle.textTransform, "uppercase");
  for (const file of ["AgentsConfig.tsx", "SkillsConfig.tsx", "PluginsConfig.tsx"]) {
    const source = readComponent(file);
    assert.match(source, /sidebarGroupStyle/, `${file} must use the shared group style`);
    assert.doesNotMatch(source, /padding: "4px 8px 3px"/, `${file} must not re-hardcode the group header`);
  }
});

test("the agents sidebar keeps the shared list and footer shape", () => {
  const source = readComponent("AgentsConfig.tsx");
  // No pinned header band and no widened column — both broke parity with the
  // skills/plugins managers.
  assert.doesNotMatch(source, /sidebarWidth=\{240\}/);
  assert.match(source, /padding: "8px 6px", borderTop: "1px solid var\(--border\)", flexShrink: 0/);
  // The add action is the same flat, icon-led row the other managers use.
  assert.match(source, /<PlusIcon size=\{13\} \/>/);
});

// Regression: the agents nav entry rendered no badge while skills and plugins
// both had one, and the first attempt showed "0/3" whenever the built-in master
// switch was off.
test("the settings nav gives the agents tab its own badge", () => {
  const source = readComponent("SettingsModal.tsx");
  assert.match(source, /item\.id === "agents" && navStats\.agents !== null/);
  assert.match(source, /agents: countEffectiveSubagentProfiles\(all\)/);
  assert.doesNotMatch(source, /\/api\/subagents\/settings/);
});
