import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  WALLPAPER_SCRIM_MIN,
  WALLPAPER_SCRIM_MAX,
  WALLPAPER_SCRIM_DEFAULT,
  WALLPAPER_MIME_TYPES,
  WALLPAPER_STORAGE_BUDGET,
  clampWallpaperScrim,
  isSupportedWallpaperMime,
  inferWallpaperMime,
} = await jiti.import("./wallpaper.ts");

test("scrim constants form a sane range", () => {
  assert.ok(WALLPAPER_SCRIM_MIN < WALLPAPER_SCRIM_DEFAULT);
  assert.ok(WALLPAPER_SCRIM_DEFAULT < WALLPAPER_SCRIM_MAX);
  assert.equal(WALLPAPER_SCRIM_DEFAULT, 70);
  // Stays safely under the ~5MB localStorage quota even with other settings.
  assert.ok(WALLPAPER_STORAGE_BUDGET < 4_500_000);
});

test("clampWallpaperScrim clamps to the 30–95 range", () => {
  assert.equal(clampWallpaperScrim(0), WALLPAPER_SCRIM_MIN);
  assert.equal(clampWallpaperScrim(-10), WALLPAPER_SCRIM_MIN);
  assert.equal(clampWallpaperScrim(100), WALLPAPER_SCRIM_MAX);
  assert.equal(clampWallpaperScrim(999), WALLPAPER_SCRIM_MAX);
});

test("clampWallpaperScrim rounds to integers and keeps in-range values", () => {
  assert.equal(clampWallpaperScrim(75), 75);
  assert.equal(clampWallpaperScrim(72.4), 72);
  assert.equal(clampWallpaperScrim(72.6), 73);
  assert.equal(clampWallpaperScrim(30), WALLPAPER_SCRIM_MIN);
  assert.equal(clampWallpaperScrim(95), WALLPAPER_SCRIM_MAX);
});

test("isSupportedWallpaperMime accepts raster formats only", () => {
  for (const mime of WALLPAPER_MIME_TYPES) {
    assert.equal(isSupportedWallpaperMime(mime), true, mime);
  }
  assert.equal(isSupportedWallpaperMime("image/svg+xml"), false, "svg rejected");
  assert.equal(isSupportedWallpaperMime("image/gif"), false, "gif rejected");
  assert.equal(isSupportedWallpaperMime("text/html"), false);
  assert.equal(isSupportedWallpaperMime(""), false);
  assert.equal(isSupportedWallpaperMime("image/jpeg;base64"), false);
});

test("inferWallpaperMime trusts File.type and falls back to the extension", () => {
  assert.equal(inferWallpaperMime("photo.png", "image/png"), "image/png");
  assert.equal(inferWallpaperMime("photo.png", "image/webp"), "image/webp", "type wins");
  assert.equal(inferWallpaperMime("photo.png", ""), "image/png", "empty type + png ext");
  assert.equal(inferWallpaperMime("photo.jpg", ""), "image/jpeg");
  assert.equal(inferWallpaperMime("photo.JPEG", ""), "image/jpeg", "case-insensitive ext");
  assert.equal(inferWallpaperMime("photo.webp", ""), "image/webp");
  assert.equal(inferWallpaperMime("photo.unknown", ""), "", "unknown stays unsupported");
  assert.equal(inferWallpaperMime("evil.svg", "image/svg+xml"), "image/svg+xml", "svg stays rejected");
});
