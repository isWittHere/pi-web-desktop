import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { replaceUploadFile } = await import("../lib/file-upload.ts");

const freshDir = () => mkdtempSync(join(tmpdir(), "pi-web-upload-"));

test("a failed replacement keeps the old file intact", () => {
  const dir = freshDir();
  try {
    const destination = join(dir, "notes.md");
    writeFileSync(destination, "the original content");
    // An empty replacement is not what fails a real write, so make the rename
    // itself impossible: a directory where the file has to land.
    const bytes = Buffer.from("a replacement");

    // Stage-first means the original is only ever replaced by a complete file.
    // Simulate the failure the old unlink-then-write order could not survive by
    // pointing the destination at something the rename refuses.
    const blocked = join(dir, "blocked");
    mkdirSync(blocked);
    writeFileSync(join(blocked, "inner.txt"), "keep me");
    assert.throws(() => replaceUploadFile(blocked, bytes), /directory or symbolic link/);
    assert.equal(readFileSync(join(blocked, "inner.txt"), "utf8"), "keep me");
    assert.ok(statSync(blocked).isDirectory());

    assert.equal(readFileSync(destination, "utf8"), "the original content");
    replaceUploadFile(destination, bytes);
    assert.equal(readFileSync(destination, "utf8"), "a replacement");
    // No staging directory is left behind.
    assert.deepEqual(
      readFileSync(join(dir, "notes.md"), "utf8"),
      "a replacement",
    );
    const leftovers = readdirSync(dir).filter((name) => name.startsWith(".pi-upload-"));
    assert.deepEqual(leftovers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a symbolic link is never written through, and no staging file survives", () => {
  const dir = freshDir();
  try {
    const outside = join(dir, "outside");
    mkdirSync(outside);
    const target = join(outside, "secret.txt");
    writeFileSync(target, "do not touch");
    const link = join(dir, "link.txt");
    symlinkSync(target, link);

    assert.throws(() => replaceUploadFile(link, Buffer.from("payload")), /directory or symbolic link/);
    assert.equal(readFileSync(target, "utf8"), "do not touch");
    assert.ok(lstatSync(link).isSymbolicLink());
    const leftovers = readdirSync(dir).filter((name) => name.startsWith(".pi-upload-"));
    assert.deepEqual(leftovers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the replacement keeps the old file's mode", () => {
  const dir = freshDir();
  try {
    const destination = join(dir, "script.sh");
    writeFileSync(destination, "old", { mode: 0o755 });
    const before = statSync(destination).mode & 0o777;
    replaceUploadFile(destination, Buffer.from("new"));
    assert.equal(statSync(destination).mode & 0o777, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the upload route replaces through replaceUploadFile, never unlink-then-write", async () => {
  const source = await readFileSync(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
  assert.match(source, /if \(conflictSet\.has\(file\.name\)\) \{\n\s*replaceUploadFile\(destination, bytes\);/);
  assert.doesNotMatch(source, /fs\.unlinkSync\(destination\)/);
});
