import assert from "node:assert/strict";
import test from "node:test";

import { FALLBACK_PALETTE, FALLBACK_PALETTE_LIGHT, LANE_COLOR_COUNT, deriveLanePalette } from "./git-graph-palette.ts";

test("derives a hue-rotated palette from the theme accent", () => {
  const palette = deriveLanePalette("#5871a3", true);
  assert.equal(palette.length, LANE_COLOR_COUNT);
  // Lane 0 keeps the accent hue; the rest rotate around the wheel.
  assert.match(palette[0], /^hsl\(\d+ /);
  const hues = palette.map((color) => Number(color.match(/^hsl\((\d+) /)[1]));
  assert.equal(new Set(hues).size, LANE_COLOR_COUNT);
  for (const color of palette) {
    assert.match(color, /^hsl\(\d+ \d+% 55%\)$/);
  }
});

test("light mode deepens the tones instead of reusing dark lightness", () => {
  const dark = deriveLanePalette("#5871a3", true);
  const light = deriveLanePalette("#5871a3", false);
  assert.notDeepEqual(dark, light);
  assert.equal(light.length, LANE_COLOR_COUNT);
  // Same hue rotation, deeper lightness for contrast on light backgrounds.
  const darkHues = dark.map((color) => color.match(/^hsl\((\d+) /)[1]);
  const lightHues = light.map((color) => color.match(/^hsl\((\d+) /)[1]);
  assert.deepEqual(lightHues, darkHues);
  for (const color of light) {
    assert.match(color, /^hsl\(\d+ \d+% (38|40)%\)$/);
  }
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
