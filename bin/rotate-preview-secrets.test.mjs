import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { PRERENDER_MANIFEST, rotatePreviewSecrets, getRotationWarning } = await import("./rotate-preview-secrets.js");

const manifest = () => ({
  routes: {},
  dynamicRoutes: {},
  notFoundRoutes: [],
  preview: {
    previewModeId: "published-preview-mode-id",
    previewModeSigningKey: "published-signing-key",
    previewModeEncryptionKey: "published-encryption-key",
  },
});

const freshDir = () => mkdtempSync(join(tmpdir(), "pi-web-preview-"));

test("replaces the published preview secrets with fresh random values", () => {
  const dir = freshDir();
  try {
    writeFileSync(join(dir, PRERENDER_MANIFEST), JSON.stringify(manifest()));
    assert.deepEqual(rotatePreviewSecrets(dir), { ok: true });

    const after = JSON.parse(readFileSync(join(dir, PRERENDER_MANIFEST), "utf8"));
    const before = manifest().preview;
    for (const key of Object.keys(before)) {
      assert.notEqual(after.preview[key], before[key], `${key} was not rotated`);
      assert.match(after.preview[key], /^[0-9a-f]+$/, `${key} is not hex`);
    }
    // Lengths mirror what Next generates at build time.
    assert.equal(after.preview.previewModeId.length, 32);
    assert.equal(after.preview.previewModeSigningKey.length, 64);
    assert.equal(after.preview.previewModeEncryptionKey.length, 64);
    // Everything else in the manifest survives untouched.
    assert.deepEqual(after.routes, {});
    assert.deepEqual(after.dynamicRoutes, {});
    assert.deepEqual(after.notFoundRoutes, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each launch gets its own secrets", () => {
  const a = freshDir();
  const b = freshDir();
  try {
    for (const dir of [a, b]) writeFileSync(join(dir, PRERENDER_MANIFEST), JSON.stringify(manifest()));
    rotatePreviewSecrets(a);
    rotatePreviewSecrets(b);
    const read = (dir) => JSON.parse(readFileSync(join(dir, PRERENDER_MANIFEST), "utf8")).preview;
    assert.notEqual(read(a).previewModeId, read(b).previewModeId);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("leaves no temp file behind, so a concurrent next start never reads half a manifest", () => {
  const dir = freshDir();
  try {
    writeFileSync(join(dir, PRERENDER_MANIFEST), JSON.stringify(manifest()));
    rotatePreviewSecrets(dir);
    const left = statSync(join(dir, PRERENDER_MANIFEST));
    assert.ok(left.isFile());
    // The rename target is the manifest itself; nothing else should appear.
    assert.throws(() => statSync(join(dir, `${PRERENDER_MANIFEST}.${process.pid}.tmp`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a read-only or missing manifest is reported, never silently left vulnerable", () => {
  const missing = freshDir();
  try {
    assert.deepEqual(rotatePreviewSecrets(missing), { ok: false, reason: "missing" });
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }

  const unreadable = freshDir();
  try {
    writeFileSync(join(unreadable, PRERENDER_MANIFEST), "{ not json");
    const result = rotatePreviewSecrets(unreadable);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unreadable");
  } finally {
    rmSync(unreadable, { recursive: true, force: true });
  }

  const odd = freshDir();
  try {
    writeFileSync(join(odd, PRERENDER_MANIFEST), JSON.stringify({ routes: {} }));
    assert.deepEqual(rotatePreviewSecrets(odd), { ok: false, reason: "unexpected-shape" });
  } finally {
    rmSync(odd, { recursive: true, force: true });
  }
});

test("the warning names the reason and the header that bypasses the proxy", () => {
  const warning = getRotationWarning("unwritable");
  assert.match(warning, /not writable/);
  assert.match(warning, /x-prerender-revalidate/);
  assert.match(warning, /authentication and Host\/Origin checks/);
  assert.match(getRotationWarning("missing"), /prerender manifest is missing/);
  assert.match(getRotationWarning("unreadable"), /could not be read/);
  assert.match(getRotationWarning("nonsense"), /unexpected format/);
});

test("both launch paths rotate before next starts: the bin entry and the Electron fork", async () => {
  // electron/main.js forks `next start` directly and never goes through
  // bin/pi-web.js, so it has to call the rotation itself.
  const { readFile: read } = await import("node:fs/promises");
  const bin = (await read(new URL("./pi-web.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(bin, /rotatePreviewSecrets\(nextDir\)/);
  assert.match(bin, /if \(!rotation\.ok\) \{\n\s*console\.warn\(getRotationWarning\(rotation\.reason\)\);/);
  // Before the spawn, not after.
  assert.ok(bin.indexOf("rotatePreviewSecrets(nextDir)") < bin.indexOf("spawn(process.execPath"));

  const main = (await read(new URL("../electron/main.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(main, /require\("\.\.\/bin\/rotate-preview-secrets"\)/);
  assert.match(main, /rotatePreviewSecrets\(path\.join\(pkgDir, "\.next"\)\)/);
  assert.ok(main.indexOf("rotatePreviewSecrets(path.join(pkgDir") < main.indexOf("fork(nextBin, args"));
});

test("the packaged desktop app ships the module it requires at runtime", async () => {
  const { readFile: read } = await import("node:fs/promises");
  const pkg = JSON.parse(await read(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.files.includes("bin"), "the npm tarball must ship bin/");
  assert.ok(
    pkg.build.files.some((pattern) => pattern.includes("bin/rotate-preview-secrets.js")),
    "electron-builder must package bin/rotate-preview-secrets.js, which electron/main.js requires",
  );
});

// A read-only directory cannot be reproduced portably on Windows (chmod is a
// no-op there), so the unwritable branch is covered by the shape tests above.
void chmodSync;
