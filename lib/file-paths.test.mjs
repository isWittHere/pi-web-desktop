import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { filePathFromSegments } = await jiti.import("./file-paths.ts");

test("reassembles catch-all segments into filesystem paths", () => {
  assert.equal(filePathFromSegments(["E:", "Dev", "pi-web-main"]), "E:/Dev/pi-web-main");
  assert.equal(filePathFromSegments(["home", "user", "project"]), "/home/user/project");
  assert.equal(filePathFromSegments([]), "/");
});

test("treats a bare drive letter as the drive root, not a POSIX path", () => {
  // /api/files/C%3A arrives as a single "C:" segment; it must resolve to the
  // drive root. Without this, "C:" fails the absolute-path check (which needs
  // a separator after the colon), degrades to "/C:" and every stat/readdir
  // under it fails with ENOENT.
  assert.equal(filePathFromSegments(["C:"]), "C:/");
  assert.equal(filePathFromSegments(["e:"]), "e:/");
  assert.equal(filePathFromSegments(["C:", "Users"]), "C:/Users");
});
