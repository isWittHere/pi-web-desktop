import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SettingsChipGroup } = await jiti.import("./settings-ui.tsx");

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
