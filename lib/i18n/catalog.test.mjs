import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enLocale } = await jiti.import("./messages/en.ts");
const { zhCNLocale } = await jiti.import("./messages/zh-CN.ts");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function getKeys(messages) {
  return Object.keys(messages).sort();
}

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(filePath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [filePath] : [];
  });
}

test("English and Simplified Chinese catalogs contain the same namespaced keys", () => {
  const enKeys = getKeys(enLocale.messages);
  assert.deepEqual(getKeys(zhCNLocale.messages), enKeys);
  assert.deepEqual(enKeys.filter((key) => !key.includes(".")), []);
});

test("every literal UI translation call resolves to a namespaced catalog key", () => {
  const calls = new Set();
  for (const directory of ["app", "components", "hooks"]) {
    for (const filePath of collectSourceFiles(path.join(projectRoot, directory))) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const match of source.matchAll(/\b(?:t|ts)\(\s*["']([^"']+)["']/g)) calls.add(match[1]);
    }
  }

  const nonNamespaced = [...calls].filter((key) => !key.includes("."));
  const missing = [...calls].filter((key) => !(key in enLocale.messages));
  assert.deepEqual(nonNamespaced, []);
  assert.deepEqual(missing, []);
});

test("the UI no longer imports the removed useLanguage compatibility hook", () => {
  const imports = [];
  for (const directory of ["app", "components", "hooks"]) {
    for (const filePath of collectSourceFiles(path.join(projectRoot, directory))) {
      if (filePath.endsWith(path.join("hooks", "useLanguage.ts"))) continue;
      const source = fs.readFileSync(filePath, "utf8");
      if (source.includes("@/hooks/useLanguage")) imports.push(path.relative(projectRoot, filePath));
    }
  }
  assert.deepEqual(imports, []);
});
