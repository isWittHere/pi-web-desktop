import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { EXTENSION_DIALOG_BASE_WIDTH, fitExtensionDialogWidth } = await jiti.import("./extension-dialog-fit.ts");

test("a dialog grows by exactly the widest overflow, rounded up to a step", () => {
  assert.equal(fitExtensionDialogWidth(560, []), null);
  assert.equal(fitExtensionDialogWidth(560, [0]), null);
  // Sub-pixel rounding is not content that is cut off.
  assert.equal(fitExtensionDialogWidth(560, [1]), null);
  assert.equal(fitExtensionDialogWidth(560, [80]), 640);
  assert.equal(fitExtensionDialogWidth(560, [80, 200, 5]), 760);
  // The result may exceed the screen; the dialog is capped to its container.
  assert.equal(fitExtensionDialogWidth(560, [5000]), 5560);
});

test("the base width is the historical 560px", () => {
  assert.equal(EXTENSION_DIALOG_BASE_WIDTH, 560);
});

test("the dialog opens at the base width and only ever grows", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = (await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(source, /width: full \? "100%" : `min\(\$\{fitWidth \?\? EXTENSION_DIALOG_BASE_WIDTH\}px, 100%\)`/);
  assert.match(source, /maxHeight: full \? "100%" : "min\(760px, 100%\)"/);
  // Only ever grow: shrinking would make the dialog jump while it is read.
  assert.match(source, /setFitWidth\(\(prev\) => \(prev !== null && prev >= needed \? prev : needed\)\)/);
  // Code blocks and tables are what can overflow; prose wraps.
  assert.match(source, /querySelectorAll<HTMLElement>\("pre, \.markdown-table-wrap"\)/);
  // Highlighted code and a late web font both reflow, so both are watched.
  assert.match(source, /const mutations = new MutationObserver\(fit\);/);
  assert.match(source, /void document\.fonts\?\.ready\.then\(fit\);/);
  // The maximize button is the user's own override, and it says what it does.
  assert.match(source, /onClick=\{toggleFull\}/);
  assert.match(source, /aria-label=\{full \? t\("desktop\.extensionRestoreSize"\) : t\("desktop\.extensionMaximize"\)\}/);
});

test("the maximize and restore labels exist in both catalogs", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const locale of ["en", "zh-CN"]) {
    const catalog = await readFile(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    assert.ok(catalog.includes('"desktop.extensionMaximize"'), `${locale} is missing the maximize label`);
    assert.ok(catalog.includes('"desktop.extensionRestoreSize"'), `${locale} is missing the restore label`);
  }
});
