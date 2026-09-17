import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { encodeFilePathForApi, filePathFromSegments } = await jiti.import("./file-paths.ts");

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
test("encodes UNC roots into the first API segment", () => {
  // The leading "//" is normalized away by URL routing before the catch-all
  // handler, so it must be folded into segment one as %2F%2F and preserved on decode.
  assert.equal(encodeFilePathForApi("\\\\192.0.2.1\\share\\dir"), "%2F%2F192.0.2.1/share/dir");
  assert.equal(encodeFilePathForApi("//192.0.2.1/share/dir"), "%2F%2F192.0.2.1/share/dir");
  assert.equal(encodeFilePathForApi("D:\\repo\\a file.ts"), "D%3A/repo/a%20file.ts");
  assert.equal(encodeFilePathForApi("/tmp/a file.ts"), "tmp/a%20file.ts");
});

test("filePathFromSegments restores UNC roots", () => {
  // Next.js delivers "%2F%2Fhost" as a single decoded "//host" segment.
  assert.equal(filePathFromSegments(["//192.0.2.1", "share", "dir"]), "//192.0.2.1/share/dir");
  assert.equal(filePathFromSegments(["//192.0.2.1", "share"]), "//192.0.2.1/share");
});
