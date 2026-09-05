import assert from "node:assert/strict";
import test from "node:test";

import { FALLBACK_PALETTE, LANE_COLOR_COUNT, deriveLanePalette } from "./git-graph-palette.ts";

test("derives a hue-rotated palette from the theme accent", () => {
  const palette = deriveLanePalette("#5871a3");
  assert.equal(palette.length, LANE_COLOR_COUNT);
  // Lane 0 keeps the accent hue; the rest rotate around the wheel.
  assert.match(palette[0], /^hsl\(\d+ /);
  const hues = palette.map((color) => Number(color.match(/^hsl\((\d+) /)[1]));
  assert.equal(new Set(hues).size, LANE_COLOR_COUNT);
  for (const color of palette) {
    assert.match(color, /^hsl\(\d+ \d+% 55%\)$/);
  }
});

test("3-digit hex accents are supported", () => {
  const palette = deriveLanePalette("#58a");
  assert.equal(palette.length, LANE_COLOR_COUNT);
  assert.notDeepEqual(palette, FALLBACK_PALETTE);
});

test("unparseable or near-grey accents fall back to the fixed palette", () => {
  assert.deepEqual(deriveLanePalette("not-a-color"), FALLBACK_PALETTE);
  assert.deepEqual(deriveLanePalette(""), FALLBACK_PALETTE);
  assert.deepEqual(deriveLanePalette("#444444"), FALLBACK_PALETTE);
});
