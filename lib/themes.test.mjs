import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const themeDir = fileURLToPath(new URL("./themes", import.meta.url));

/** Load a theme JSON file and assert it is structurally valid. */
function loadTheme(filename) {
  const raw = readFileSync(join(themeDir, filename), "utf8");
  const json = JSON.parse(raw);
  assert.ok(typeof json.name === "string" && json.name.length > 0, `${filename} must have a name`);
  assert.ok(json.colors && typeof json.colors === "object", `${filename} must have colors`);
  return json;
}

test("every built-in theme JSON is valid and has a paired dark/light variant", () => {
  const files = readdirSync(themeDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0, "expected at least one built-in theme file");

  const bases = new Map();
  for (const f of files) {
    const m = /^(.+)-(dark|light)\.json$/.exec(f);
    assert.ok(m, `${f} must follow the <base>-<dark|light>.json convention`);
    const [, base, variant] = m;
    loadTheme(f);
    if (!bases.has(base)) bases.set(base, new Set());
    bases.get(base).add(variant);
  }

  for (const [base, variants] of bases) {
    assert.ok(variants.has("dark"), `${base} must have a dark variant`);
    assert.ok(variants.has("light"), `${base} must have a light variant`);
  }
});

test("lib/themes/index.ts registers every built-in theme set", () => {
  const files = readdirSync(themeDir).filter((f) => f.endsWith(".json"));
  const bases = new Set(
    files.map((f) => f.replace(/-dark\.json$/, "").replace(/-light\.json$/, "")),
  );

  const source = readFileSync(new URL("./themes/index.ts", import.meta.url), "utf8");
  for (const base of bases) {
    assert.match(source, new RegExp(`name: "${base}"`), `index.ts must register "${base}"`);
  }
  assert.match(source, /export const BUILTIN_THEMES/);
});

test("lib/theme.ts wires built-in themes into listThemeSets and resolveTheme", () => {
  const source = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");

  // Listed with builtin: true, but only when no user theme shares the name.
  assert.match(source, /import \{ BUILTIN_THEMES, findBuiltinTheme \} from "\.\/themes"/);
  assert.match(source, /builtin: true/);
  assert.match(source, /for \(const builtin of BUILTIN_THEMES\)/);
  assert.match(source, /if \(seen\.has\(builtin\.name\)\) continue/);

  // Resolved as a fallback after user dirs / direct paths.
  assert.match(source, /const builtin = findBuiltinTheme\(name\)/);
  assert.match(source, /builtin\.light \|\| builtin\.dark/);
  assert.match(source, /builtin\.dark \|\| builtin\.light/);
});