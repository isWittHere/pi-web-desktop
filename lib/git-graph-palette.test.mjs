import assert from "node:assert/strict";
import test from "node:test";

import { FALLBACK_PALETTE, FALLBACK_PALETTE_LIGHT, LANE_COLOR_COUNT, deriveLanePalette } from "./git-graph-palette.ts";

test("derives a hue-rotated palette that keeps the accent's own lightness", () => {
  // Gruvbox dark accent: L 55%, full saturation.
  const palette = deriveLanePalette("#fe8019", true);
  assert.equal(palette.length, LANE_COLOR_COUNT);
  // Lane 0 keeps the accent hue; the rest rotate around the wheel.
  assert.match(palette[0], /^hsl\(\d+ /);
  const hues = palette.map((color) => Number(color.match(/^hsl\((\d+) /)[1]));
  assert.equal(new Set(hues).size, LANE_COLOR_COUNT);
  for (const color of palette) {
    assert.match(color, /^hsl\(\d+ \d+% 55%\)$/);
  }
});

test("light-variant accents keep their deeper theme-tuned lightness", () => {
  // Gruvbox light accent is the same hue family but deeper (L 45%); the
  // palette must carry that depth through, not override it.
  const dark = deriveLanePalette("#fe8019", true);
  const light = deriveLanePalette("#d65d0e", false);
  assert.notDeepEqual(dark, light);
  for (const color of light) {
    assert.match(color, /^hsl\(\d+ \d+% 45%\)$/);
  }
  // Side lanes stay subordinate: damped saturation, same lightness.
  const sideS = Number(light[1].match(/^hsl\(\d+ (\d+)% /)[1]);
  const lane0S = Number(light[0].match(/^hsl\(\d+ (\d+)% /)[1]);
  assert.ok(sideS < lane0S);
});

test("3-digit hex accents are supported", () => {
  const palette = deriveLanePalette("#58a", true);
  assert.equal(palette.length, LANE_COLOR_COUNT);
  assert.notDeepEqual(palette, FALLBACK_PALETTE);
});

test("unparseable or near-grey accents fall back to the mode's fixed palette", () => {
  assert.deepEqual(deriveLanePalette("not-a-color", true), FALLBACK_PALETTE);
  assert.deepEqual(deriveLanePalette("", true), FALLBACK_PALETTE);
  assert.deepEqual(deriveLanePalette("#444444", true), FALLBACK_PALETTE);
  assert.deepEqual(deriveLanePalette("not-a-color", false), FALLBACK_PALETTE_LIGHT);
  assert.deepEqual(deriveLanePalette("", false), FALLBACK_PALETTE_LIGHT);
  assert.deepEqual(deriveLanePalette("#444444", false), FALLBACK_PALETTE_LIGHT);
});
