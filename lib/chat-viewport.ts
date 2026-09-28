/**
 * Pure viewport-decision layer.
 *
 * Every message-list mutation is described by a {@link ContentChange}; a single
 * layout effect (in `components/ChatWindow.tsx`) asks this module what to do.
 * Keeping the policy here — no React, no DOM — makes scroll behaviour
 * unit-testable and keeps the number of viewport writers at exactly one per
 * committed change.
 *
 * The old design reacted to `messages.length` in several independent effects
 * and coordinated them with ad-hoc boolean refs (`justCompactedRef`,
 * `suppressAutoScrollRef`, `completionScrollAllowedRef`, …). That interleaving
 * is what made post-compaction jumps probabilistic; this module replaces the
 * "which flag wins" question with an explicit, ordered decision.
 */

/** Distance (px) within which the viewport counts as pinned to the bottom. */
export const BOTTOM_EPS = 8;

export type ContentChangeKind = "initial" | "append" | "prepend" | "replace" | "compact";

/** Description of a single committed message-list change. */
export interface ContentChange {
  /** Monotonic content revision this change produced. */
  rev: number;
  kind: ContentChangeKind;
  /** `scrollTop` measured just before the content committed. */
  prevScrollTop: number;
  /** `scrollHeight` measured just before the content committed. */
  prevScrollHeight: number;
  /** Entry to reveal after a `replace` (search jump / edit-from-here). */
  targetEntryId?: string | null;
  /**
   * `replace` intent: return the viewport to the bottom once the run ends,
   * provided the user has not taken over the viewport during the run.
   * Ignored for every other kind.
   */
  followBottom?: boolean;
  /**
   * `append` intent: the just-added message is the user's own optimistic send,
   * so anchor it at the top of the viewport (post-send auto-scroll) instead of
   * following the bottom.
   */
  pinUserMessageTop?: boolean;
}

/** Read-only viewport facts gathered at decision time. */
export interface ViewportContext {
  /** Scroll container is currently within {@link BOTTOM_EPS} of the bottom. */
  atBottom: boolean;
  /** The user took over the viewport (scrolled away) since the last send. */
  userOwnsViewport: boolean;
  /** At least one scroll container exists to write to. */
  containerPresent: boolean;
  /** `change.targetEntryId` is present in the currently loaded entries. */
  hasTarget: boolean;
  /**
   * Post-commit `scrollHeight`, needed to place a `prepend` anchor. Defaults to
   * `change.prevScrollHeight` when omitted (a no-op anchor).
   */
  newScrollHeight?: number;
}

export type ViewportAction =
  | { kind: "bottom"; behavior: "instant" | "smooth" }
  | { kind: "anchor"; scrollTop: number }
  | { kind: "entry" }
  | { kind: "userTop" }
  | { kind: "keep" };

/** True when the scroller sits within `eps` px of the bottom. */
export function isAtBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  eps: number = BOTTOM_EPS,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= eps;
}

/** Distance from the bottom captured before content grew above the viewport. */
export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

/**
 * `scrollTop` that keeps the content below the fold visually fixed after a
 * prepend grew the list. `newScrollHeight` is the post-commit container height.
 */
export function anchorScrollTop(change: ContentChange, newScrollHeight: number): number {
  const distance = captureScrollDistance(change.prevScrollHeight, change.prevScrollTop);
  return Math.max(0, newScrollHeight - distance);
}

/**
 * Decide the single viewport write for a committed change. Returns `keep` when
 * the browser's own clamp/anchoring must be left alone.
 */
export function decideViewportAction(change: ContentChange, ctx: ViewportContext): ViewportAction {
  if (!ctx.containerPresent) {
    // Container unmounted (manual compaction shows the loading gate). Only a
    // compaction target is re-applied later by the caller's sticky-bottom state.
    return change.kind === "compact" ? { kind: "bottom", behavior: "instant" } : { kind: "keep" };
  }

  switch (change.kind) {
    case "initial":
      // The pre-paint `openPositioning` layout effect owns the first frame;
      // the pipeline must not fight it.
      return { kind: "keep" };

    case "compact":
      // The rebuilt list is shorter, so the browser would clamp to the top.
      // Pin straight to the bottom; the caller also enters a sticky-bottom
      // target so container remounts and late layout changes stay pinned.
      return { kind: "bottom", behavior: "instant" };

    case "prepend":
      return {
        kind: "anchor",
        scrollTop: anchorScrollTop(change, ctx.newScrollHeight ?? change.prevScrollHeight),
      };

    case "replace":
      if (ctx.hasTarget) return { kind: "entry" };
      if (change.followBottom && !ctx.userOwnsViewport) return { kind: "bottom", behavior: "smooth" };
      // Branch switch / navigate-without-target: leave the browser clamp alone.
      return { kind: "keep" };

    case "append":
      if (change.pinUserMessageTop) return { kind: "userTop" };
      // Only follow when the user is already at the bottom; never yank a user
      // who deliberately scrolled up.
      return ctx.atBottom ? { kind: "bottom", behavior: "instant" } : { kind: "keep" };

    default:
      return { kind: "keep" };
  }
}
