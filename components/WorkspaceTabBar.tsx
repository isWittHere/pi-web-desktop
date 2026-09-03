"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import type { WorkspaceTab } from "@/lib/workspace-tabs";

/**
 * Browser-style workspace tab strip for the tabs view mode, rendered into
 * the title-bar workspace host. One tab per opened workspace (project root
 * when known, else cwd); the "+" picker button lives in the title bar at
 * the far left (see AppTitleBar). Closing a tab never touches sessions or
 * tasks — it only removes the bookmark (the workspace stays reachable
 * through the picker).
 */

interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeKey: string | null;
  /** Bumped whenever a workspace is opened explicitly (picking a project
   *  from the workspace picker): an intent to reveal the newly active tab.
   *  Plain programmatic activeKey changes (close-tab fallback, restore)
   *  never bump it — they must not steal the user's scroll position. */
  focusToken: number;
  /** Per-workspace running counts (tab dot). */
  activity: Map<string, { running: number; unread: number }>;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  /** Browser-style drag reorder: move `fromKey` before/after `targetKey`. */
  onReorderTab: (fromKey: string, targetKey: string, position: "before" | "after") => void;
}

function pathBaseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
}

// Electron frameless window: elements inside a drag region need explicit
// no-drag to stay interactive, and the strip's empty area can act as the
// drag region. React's CSSProperties type does not include the vendor
// region property, so the values are cast through it once here.
const NO_DRAG_REGION = { WebkitAppRegion: "no-drag" } as unknown as React.CSSProperties;
const DRAG_REGION = { WebkitAppRegion: "drag" } as unknown as React.CSSProperties;

// Pointer travel (px) between press and release that turns a press into a
// drag instead of a click. Small enough to feel immediate, large enough
// that ordinary click jitter never starts a reorder.
const DRAG_START_THRESHOLD = 5;

/** Spinning arc — a task is currently running in this workspace. CSS
 *  rotation (not SMIL animateTransform): under the app's CSS zoom scaling
 *  the SMIL rotate center drifts off the arc's center, while a CSS
 *  transform with transform-origin 50% 50% rotates around the box center. */
function RunningArcIndicator() {
  return (
    <span
      style={{
        display: "inline-flex",
        animation: "spin 0.9s linear infinite",
        transformOrigin: "50% 50%",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <path
          d="M21 12a9 9 0 1 1-3.8-7.4"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Breathing dot — finished tasks are unread in this workspace. */
function UnreadDotIndicator() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <circle cx="7" cy="7" r="3" fill="currentColor">
        <animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

interface DropTarget {
  key: string;
  position: "before" | "after";
}

export function WorkspaceTabBar({
  tabs,
  activeKey,
  focusToken,
  activity,
  onSelectTab,
  onCloseTab,
  onReorderTab,
}: WorkspaceTabBarProps) {
  const { t } = useI18n();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // A card hovered while its tab closed keeps the stale key: when the same
  // workspace tab is reopened later (same key), the new card would render
  // pre-lit, and no mouseleave can ever clear it — the pointer was never
  // over it. Prune keys that no longer exist whenever the tab list changes.
  useEffect(() => {
    setHoveredKey((cur) => (cur !== null && !tabs.some((t) => t.key === cur) ? null : cur));
  }, [tabs]);
  // Pointer drag reorder state: the tab being dragged and the insertion line
  // position relative to the hovered tab.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // True when the tab strip overflows its container (many tabs): the strip
  // then stays a normal scrollable region instead of the window drag area.
  const [stripOverflow, setStripOverflow] = useState(false);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const check = () => setStripOverflow(strip.scrollWidth > strip.clientWidth + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [tabs.length]);

  // ── Reveal a tab: scroll the strip so the tab is fully visible ─────────
  // Triggered only by explicit user intents (mount/re-enter, tab click,
  // picker open); programmatic switches (close-tab fallback, restore) must
  // never fight the user's scroll position. The scrollbar is hidden, so an
  // un-revealed tab is effectively invisible without this. Uses rect math
  // (not offsetLeft) because the strip lives in a portal host inside the
  // title bar, and offsetParent can climb past the static strip to an outer
  // positioned ancestor.
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollToTab = useCallback((key: string, behavior: ScrollBehavior = "smooth") => {
    const strip = stripRef.current;
    const el = tabRefs.current.get(key);
    if (!strip || !el) return;
    const sRect = strip.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const MARGIN = 10;
    const left = eRect.left - sRect.left + strip.scrollLeft;
    const right = left + eRect.width;
    const viewLeft = strip.scrollLeft;
    const viewRight = viewLeft + strip.clientWidth;
    if (left < viewLeft + MARGIN) {
      strip.scrollTo({ left: left - MARGIN, behavior });
    } else if (right > viewRight - MARGIN) {
      strip.scrollTo({ left: right - strip.clientWidth + MARGIN, behavior });
    }
  }, []);

  // Reveal the restored active tab on mount — covers both app start and
  // re-entering the tabs view (the strip unmounts when switching view modes).
  // The key is captured in a ref at mount render so the effect never scrolls
  // on later programmatic activeKey changes; scrollToTab is stable.
  // rAF: the first layout pass after a portal mount can still be unstable.
  const mountActiveKeyRef = useRef(activeKey);
  useEffect(() => {
    const initial = mountActiveKeyRef.current;
    if (!initial) return;
    const raf = requestAnimationFrame(() => scrollToTab(initial, "auto"));
    return () => cancelAnimationFrame(raf);
  }, [scrollToTab]);

  // Picker-opened workspace: the focusToken bump is an explicit intent, so
  // reveal the tab that is active after the open commits. Token bumps are
  // rare and batched with the tabs state update, so props.activeKey is
  // already the opened tab when this effect runs.
  const prevFocusTokenRef = useRef(focusToken);
  useEffect(() => {
    if (focusToken === prevFocusTokenRef.current) return;
    prevFocusTokenRef.current = focusToken;
    if (activeKey) scrollToTab(activeKey, "smooth");
  }, [focusToken, activeKey, scrollToTab]);

  // Wheel-to-horizontal scrolling. Must be a native non-passive listener:
  // React registers wheel passively at the root, so preventDefault() inside
  // onWheel is a no-op (and logs a console warning). The gate uses the live
  // DOM scrollable range (not the stripOverflow state) so it is immune to
  // the ResizeObserver async gap; when nothing overflows the strip is the
  // window drag region anyway and wheel events never reach this handler.
  // The wheel passes through at the ends so it never traps over the bar.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      if (maxScroll <= 1) return;
      // Touchpads already produce deltaX for lateral swipes; wheels only
      // produce deltaY — map it to the horizontal axis.
      const raw = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      // Line-mode deltas (deltaMode 1) scroll too slowly as raw pixels.
      const px = e.deltaMode === 1 ? raw * 16 : raw;
      const canGo = (px < 0 && strip.scrollLeft > 0) || (px > 0 && strip.scrollLeft < maxScroll);
      if (!canGo) return;
      e.preventDefault();
      strip.scrollLeft += px;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  // ── Pointer-based drag reorder ──────────────────────────────────────────
  // HTML5 draggable was the previous mechanism, and it ate plain clicks:
  // any pointer jitter past the native drag threshold between mousedown and
  // mouseup started a real drag and cancelled the click, so switching tabs
  // failed intermittently. A click and a reorder are indistinguishable
  // until the pointer actually moves, so pressing only *arms* a pending
  // drag; past the threshold it becomes one. Pointer capture keeps the
  // gesture on the pressed tab even when the pointer leaves it, so no
  // window-level listeners are needed. The click that follows a committed
  // drag is suppressed once (didDragRef).
  const dragStateRef = useRef<{
    pointerId: number;
    key: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const didDragRef = useRef(false);
  const dropTargetRef = useRef<DropTarget | null>(null);

  const applyDropTarget = useCallback((next: DropTarget | null) => {
    dropTargetRef.current = next;
    setDropTarget((prev) =>
      prev && next && prev.key === next.key && prev.position === next.position ? prev : next,
    );
  }, []);

  // Resolve the drop slot under the pointer. elementFromPoint because the
  // pointer is captured by the pressed tab, so the event target is always
  // the source tab, never the tab currently hovered.
  const updateDropTargetFromPoint = useCallback((clientX: number, clientY: number, fromKey: string) => {
    const strip = stripRef.current;
    if (!strip) return;
    const hit = document.elementFromPoint(clientX, clientY) as Element | null;
    const tabEl = hit?.closest("[data-tab-key]") as HTMLElement | null;
    const targetKey = tabEl?.dataset.tabKey;
    if (targetKey) {
      if (targetKey === fromKey) return;
      const rect = tabEl.getBoundingClientRect();
      applyDropTarget({
        key: targetKey,
        position: clientX < rect.left + rect.width / 2 ? "before" : "after",
      });
      return;
    }
    if (hit && strip.contains(hit)) {
      // Strip whitespace right of the last tab: default to the trailing slot.
      const last = tabs[tabs.length - 1];
      if (last && last.key !== fromKey) applyDropTarget({ key: last.key, position: "after" });
      return;
    }
    applyDropTarget(null);
  }, [applyDropTarget, tabs]);

  const endDrag = useCallback(() => {
    const st = dragStateRef.current;
    dragStateRef.current = null;
    if (!st?.active) return;
    const drop = dropTargetRef.current;
    if (drop && drop.key !== st.key) onReorderTab(st.key, drop.key, drop.position);
    setDragKey(null);
    applyDropTarget(null);
  }, [applyDropTarget, onReorderTab]);

  const handleTabPointerDown = (e: React.PointerEvent<HTMLDivElement>, key: string) => {
    if (e.button !== 0 || e.pointerType !== "mouse" || tabs.length < 2) return;
    // Presses on the close button must neither arm a drag nor take pointer
    // capture: capture retargets the follow-up click to this container, so
    // the button's onClick would never fire and closing would appear dead.
    if ((e.target as Element).closest("button")) return;
    dragStateRef.current = {
      pointerId: e.pointerId,
      key,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    didDragRef.current = false;
    // Capture so moves and the release outside the strip still reach this
    // tab's handlers.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleTabPointerMove = (e: React.PointerEvent<HTMLDivElement>, key: string) => {
    const st = dragStateRef.current;
    if (!st || st.key !== key) return;
    if (!st.active) {
      if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < DRAG_START_THRESHOLD) return;
      st.active = true;
      didDragRef.current = true;
      setDragKey(key);
      applyDropTarget(null);
    }
    updateDropTargetFromPoint(e.clientX, e.clientY, key);
  };

  // The strip's empty area is the Electron window drag region (the fixed
  // drag handle is removed in expanded title-bar mode). While a tab is being
  // dragged or the strip overflows, the region must stay interactive instead
  // (drag-over targets / wheel scrolling), so the drag region is disabled
  // then. Tabs and buttons stay no-drag so they never start a window move.
  // The strip is the component root: it fills the host directly (the old
  // wrapper div held the "+" button and its absolutely-positioned dropdown,
  // which now live in AppTitleBar).
  const stripDragRegion = !dragKey && !stripOverflow;
  const stripStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: "100%",
    minWidth: 0,
    flex: 1,
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
    ...(stripDragRegion ? DRAG_REGION : {}),
  };

  return (
    <div
      ref={stripRef}
      style={stripStyle}
    >
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          const running = activity.get(tab.key)?.running ?? 0;
          const unread = activity.get(tab.key)?.unread ?? 0;
          const isDragging = dragKey === tab.key;
          const isDropBefore = dropTarget?.key === tab.key && dropTarget.position === "before";
          const isDropAfter = dropTarget?.key === tab.key && dropTarget.position === "after";
          const isHovered = hoveredKey === tab.key;
          return (
            <div
              key={tab.key}
              data-tab-key={tab.key}
              title={tab.cwd}
              ref={(el) => {
                if (el) {
                  tabRefs.current.set(tab.key, el);
                } else {
                  tabRefs.current.delete(tab.key);
                }
              }}
              onClick={() => {
                // A drag that just committed must not also switch tabs.
                if (didDragRef.current) {
                  didDragRef.current = false;
                  return;
                }
                scrollToTab(tab.key);
                onSelectTab(tab.key);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => handleTabPointerDown(e, tab.key)}
              onPointerMove={(e) => handleTabPointerMove(e, tab.key)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onMouseEnter={() => setHoveredKey(tab.key)}
              onMouseLeave={() => setHoveredKey((cur) => (cur === tab.key ? null : cur))}
              style={{
                display: "flex",
                alignItems: "center",
                height: 36,
                paddingLeft: 3,
                paddingRight: 1,
                flexShrink: 0,
                minWidth: 60,
                maxWidth: 200,
                cursor: "pointer",
                userSelect: "none",
                ...NO_DRAG_REGION,
              }}
            >
              {/* Visual card inside a full-height hit container: the container
                  covers the whole 36px column and the gaps between cards, so
                  clicks near the card edges always land on a no-drag element
                  instead of the strip's window-drag region (which swallows
                  mousedown in Chromium). */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                  height: 28,
                  padding: "0 4px 0 10px",
                  borderRadius: 6,
                  // Insertion line (drag reorder): inset box-shadow so it does
                  // not change the tab's box size.
                  boxShadow: isDropBefore
                    ? "inset 2px 0 0 var(--accent)"
                    : isDropAfter
                      ? "inset -2px 0 0 var(--accent)"
                      : "none",
                  background: isActive
                    ? "var(--bg-selected)"
                    : isHovered && !isDragging
                      ? "var(--bg-hover)"
                      : "transparent",
                  color: isActive || isHovered ? "var(--text)" : "var(--text-muted)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  opacity: isDragging ? 0.45 : 1,
                  transition: "background 0.1s, color 0.1s",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    flex: 1,
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  {pathBaseName(tab.key)}
                </span>
                {/* Status: spinning arc while a task runs (priority), breathing
                    dot when finished tasks are unread. */}
                {running > 0 ? (
                  <span
                    title={t("desktop.agentRunning")}
                    style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", color: "var(--accent)" }}
                    aria-hidden="true"
                  >
                    <RunningArcIndicator />
                  </span>
                ) : unread > 0 ? (
                  <span
                    title={t("desktop.newActivity")}
                    style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", color: "var(--accent)" }}
                    aria-hidden="true"
                  >
                    <UnreadDotIndicator />
                  </span>
                ) : null}
                <button
                  className="workspace-tab-close"
                  onClick={(e) => { e.stopPropagation(); onCloseTab(tab.key); }}
                  title={t("desktop.closeWorkspaceTab")}
                  aria-label={t("desktop.closeWorkspaceTabWithLabel", { label: pathBaseName(tab.key) })}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
    </div>
  );
}
