/**
 * Compact-composer state machine for the reading experience.
 *
 * While the user reads the conversation (scrolled away from the bottom), the
 * composer collapses to a single text row with the toolbar hidden, freeing
 * viewport space for the messages. It expands again as soon as the user
 * returns to the bottom of the conversation or focuses the input.
 *
 * The state machine is direction-aware to stay stable around the bottom
 * boundary: collapsing the composer grows the reading area, which shrinks the
 * container's maximum scrollTop and makes the browser clamp the viewport back
 * to the bottom (an artificial "upward" scroll). Without direction tracking,
 * that clamp would immediately re-expand the input, and leaving the bottom
 * would oscillate between the two states on every scroll tick. Collapsing is
 * therefore allowed only on a real upward user scroll far enough above the
 * bottom, and restoring only while actively scrolling downward. Kept pure so
 * the trigger logic is unit-testable without a DOM.
 */

/** Remaining scroll distance (px) at or below which the viewport counts as
 *  "at the bottom" — the point where the composer restores. Tolerates
 *  sub-pixel rounding and smooth-scroll landings a few px short of the true
 *  maximum. */
export const COMPACT_RESTORE_TRIGGER = 8;

/** Distance (px) the user must scroll above the bottom before the composer
 *  collapses. Prevents tiny scrolls from collapsing the input (which would
 *  yank the viewport back to the bottom when the reading area grows): the
 *  composer shrinks roughly 66px for an empty draft, so 120px leaves headroom
 *  for the single-line delta plus a comfortable reading margin. */
export const COMPACT_COLLAPSE_TRIGGER = 120;

/** How far the viewport's lower edge is above the content's end. Negative
 *  when the content does not fill the container (a short conversation never
 *  collapses the input). */
export function scrollRemaining(container: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return container.scrollHeight - container.scrollTop - container.clientHeight;
}

export type InputCompactScrollDirection = "up" | "down" | "none";

export type InputCompactAction =
  /** A scroll event on the messages container. `remaining` is the scroll
   *  distance left to the bottom, `direction` the user's scroll direction
   *  (derived from the scrollTop delta; programmatic adjustments from the
   *  collapse itself come through as "up" because the browser clamps the
   *  viewport toward the top of the scroll range), and `userIntent`
   *  distinguishes real user scrolling (wheel / touch / keyboard / scrollbar
   *  drag) from programmatic scroll positioning. */
  | { kind: "scroll"; remaining: number; direction: InputCompactScrollDirection; userIntent: boolean }
  /** The composer textarea gained focus — always expand. */
  | { kind: "focus" };

/** Next compact-composer state:
 *  - at the bottom: restore only while actively scrolling downward — a
 *    collapse-induced viewport clamp (direction "up" or "none") must never
 *    re-expand the input, or leaving the bottom flickers;
 *  - above the bottom: collapse only on a real upward user scroll, and only
 *    once the user is far enough up that the collapse cannot pull the
 *    viewport back to the bottom;
 *  - focus always expands. */
export function nextInputCompactState(prev: boolean, action: InputCompactAction): boolean {
  switch (action.kind) {
    case "focus":
      return false;
    case "scroll": {
      if (action.remaining <= COMPACT_RESTORE_TRIGGER) {
        return action.direction === "down" ? false : prev;
      }
      return action.userIntent && action.direction === "up" && action.remaining > COMPACT_COLLAPSE_TRIGGER ? true : prev;
    }
  }
}
