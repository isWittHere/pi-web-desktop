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

test("English and Simplified Chinese catalogs contain the same keys", () => {
  assert.deepEqual(getKeys(zhCNLocale.messages), getKeys(enLocale.messages));
});

test("every literal legacy t() call resolves in the compatibility catalog", () => {
  const calls = new Set();
  for (const directory of ["app", "components", "hooks"]) {
    for (const filePath of collectSourceFiles(path.join(projectRoot, directory))) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) calls.add(match[1]);
    }
  }

  const missing = [...calls].filter((key) => !(key in enLocale.messages));
  assert.deepEqual(missing, []);
});
