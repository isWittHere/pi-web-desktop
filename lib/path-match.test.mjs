import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { samePath, normalizePathKey, isWindowsPlatform } = await jiti.import("./path-match.ts");

const win = isWindowsPlatform();

test("samePath folds case and separators on Windows", () => {
  if (win) {
    assert.equal(samePath("E:\\Dev\\pi-web-main", "E:/Dev/pi-web-main"), true);
    assert.equal(samePath("E:/Dev/pi-web-main", "e:/dev/pi-web-main"), true);
    assert.equal(samePath("E:\\Dev\\pi-web-main", "E:/Dev/pi-web-other"), false);
  } else {
    assert.equal(samePath("E:\\Dev\\pi-web-main", "E:/Dev/pi-web-main"), false);
    assert.equal(samePath("/home/a", "/home/a"), true);
    assert.equal(samePath("/home/a", "/home/A"), false);
  }
  assert.equal(samePath("", ""), true);
  assert.equal(samePath("", "/x"), false);
});

test("normalizePathKey canonicalizes Windows drive letters and separators", () => {
  if (win) {
    assert.equal(normalizePathKey("e:\\dev\\pi-web-main"), "E:/dev/pi-web-main");
    assert.equal(normalizePathKey("E:/Dev/pi-web-main"), "E:/Dev/pi-web-main");
  } else {
    assert.equal(normalizePathKey("/home/user/x"), "/home/user/x");
  }
});
