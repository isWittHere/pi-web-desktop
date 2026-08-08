import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LocalFileActions.tsx", import.meta.url), "utf8");

test("recognized local files expose preview, open, copy, and file-manager actions", () => {
  assert.match(source, /t\("desktop\.previewInChat"\)/);
  assert.match(source, /t\("desktop\.openInRightPanel"\)/);
  assert.match(source, /t\("desktop\.openInBrowser"\)/);
  assert.match(source, /t\("desktop\.copyFilePath"\)/);
  assert.match(source, /t\("desktop\.revealInFolder"\)/);
  assert.match(source, /copyText\(filePath\)/);
  assert.match(source, /window\.piDesktop\?\.openExternal/);
  assert.match(source, /window\.piDesktop\?\.showItemInFolder/);
});
