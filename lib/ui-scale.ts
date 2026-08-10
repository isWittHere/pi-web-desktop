/**
 * UI/text scale helpers (Text Size setting).
 *
 * The app applies the user's scale via `zoom: var(--app-ui-scale, 1)` on the
 * root element. Under CSS `zoom`, Chromium keeps JS viewport APIs
 * (`clientX`/`clientY`, `getBoundingClientRect()`, `innerWidth`/`innerHeight`,
 * `visualViewport`) reporting *physical* pixels, while CSS pixel lengths —
 * including `position: fixed` overlay offsets — are painted at `zoom` × their
 * value. An overlay positioned from raw JS numbers therefore drifts by
 * `(zoom - 1)` × offset (e.g. 25% at 125% scale).
 *
 * Fixed overlays that anchor to the viewport or to a JS-measured rect must
 * convert their physical inputs to CSS space *once* (via `cssPx` /
 * `cssViewportSize`), after which all math — anchoring, clamping, overflow
 * checks — stays in CSS pixels and the final paint scales back to the exact
 * physical position. Pure-CSS `position: absolute` overlays (anchored to a
 * positioned ancestor) need no conversion: ancestor and overlay share the CSS
 * coordinate system and zoom scales them together.
 */
export function getUiScale(): number {
  if (typeof document === "undefined") return 1;
  return parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
}

/** Convert a physical-pixel measurement (JS viewport API result) to CSS pixels. */
export function cssPx(physical: number): number {
  return physical / getUiScale();
}

/** Viewport size in CSS pixels (what `window.innerWidth`/`innerHeight` would
 *  report if CSS `zoom` behaved like real page zoom). */
export function cssViewportSize(): { width: number; height: number } {
  const s = getUiScale();
  return { width: window.innerWidth / s, height: window.innerHeight / s };
}
