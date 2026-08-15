"use client";

import { useEffect, useRef, useState } from "react";
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

/** Spinning arc — a task is currently running in this workspace. */
function RunningArcIndicator() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path
        d="M21 12a9 9 0 1 1-3.8-7.4"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="0.9s"
        repeatCount="indefinite"
      />
    </svg>
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

export function WorkspaceTabBar({
  tabs,
  activeKey,
  activity,
  onSelectTab,
  onCloseTab,
  onReorderTab,
}: WorkspaceTabBarProps) {
  const { t } = useI18n();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  // HTML5 drag & drop state: the tab being dragged and the drop indicator
  // (insertion line) relative to the hovered tab. The mousedown that starts
  // the drag happens on the no-drag tab strip, so the Electron window drag
  // region never intercepts the session.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; position: "before" | "after" } | null>(null);
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

  // ── Drag & drop reorder ──────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, tab: WorkspaceTab) => {
    if (tabs.length < 2) return;
    e.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag without data being set.
    e.dataTransfer.setData("text/plain", tab.key);
    setDragKey(tab.key);
    setDropTarget(null);
  };

  const handleDragOver = (e: React.DragEvent, tab: WorkspaceTab) => {
    if (!dragKey) return;
    e.preventDefault(); // required to allow the drop
    e.stopPropagation(); // the strip fallback must not override the tab hit
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    // Keep the same reference so unchanged hovers do not re-render.
    setDropTarget((prev) =>
      prev && prev.key === tab.key && prev.position === position
        ? prev
        : { key: tab.key, position },
    );
  };

  // Cursor over strip whitespace (right of the last tab, or scrolled-out
  // area): default to the slot after the last tab.
  const handleStripDragOver = (e: React.DragEvent) => {
    if (!dragKey || tabs.length === 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const last = tabs[tabs.length - 1];
    setDropTarget((prev) =>
      prev && prev.key === last.key && prev.position === "after" ? prev : { key: last.key, position: "after" },
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragKey || !dropTarget) return;
    onReorderTab(dragKey, dropTarget.key, dropTarget.position);
    setDragKey(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragKey(null);
    setDropTarget(null);
  };

  // The strip's empty area is the Electron window drag region (the fixed
  // drag handle is removed in expanded title-bar mode). While a tab is being
  // dragged or the strip overflows, the region must stay interactive instead
  // (drag-over targets / wheel scrolling), so the drag region is disabled
  // then. Tabs and buttons stay no-drag so they never start a window move.
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
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        height: "100%",
        minWidth: 0,
        flex: 1,
      }}
    >
      {/* Tab strip */}
      <div
        ref={stripRef}
        onDragOver={handleStripDragOver}
        onDrop={handleDrop}
        style={stripStyle}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          const running = activity.get(tab.key)?.running ?? 0;
          const unread = activity.get(tab.key)?.unread ?? 0;
          const isDragging = dragKey === tab.key;
          const isDropBefore = dropTarget?.key === tab.key && dropTarget.position === "before";
          const isDropAfter = dropTarget?.key === tab.key && dropTarget.position === "after";
          return (
            <div
              key={tab.key}
              draggable={tabs.length > 1}
              onDragStart={(e) => handleDragStart(e, tab)}
              onDragOver={(e) => handleDragOver(e, tab)}
              onDrop={(e) => { e.stopPropagation(); handleDrop(e); }}
              onDragEnd={handleDragEnd}
              onClick={() => onSelectTab(tab.key)}
              onDoubleClick={(e) => e.stopPropagation()}
              title={tab.cwd}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 28,
                margin: "4px 1px 3px 3px",
                padding: "0 4px 0 10px",
                borderRadius: 6,
                ...NO_DRAG_REGION,
                // Insertion line (drag reorder): inset box-shadow so it does
                // not change the tab's box size.
                boxShadow: isDropBefore
                  ? "inset 2px 0 0 var(--accent)"
                  : isDropAfter
                    ? "inset -2px 0 0 var(--accent)"
                    : "none",
                background: isActive ? "var(--bg-selected)" : "transparent",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
                maxWidth: 200,
                minWidth: 60,
                flexShrink: 0,
                userSelect: "none",
                opacity: isDragging ? 0.45 : 1,
                transition: "background 0.1s, color 0.1s",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isActive ? "var(--bg-selected)" : "transparent";
                e.currentTarget.style.color = isActive ? "var(--text)" : "var(--text-muted)";
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
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.key); }}
                onMouseEnter={() => setHoveredClose(tab.key)}
                onMouseLeave={() => setHoveredClose(null)}
                title={t("desktop.closeWorkspaceTab")}
                aria-label={t("desktop.closeWorkspaceTabWithLabel", { label: pathBaseName(tab.key) })}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 22, height: 22, padding: 0, flexShrink: 0,
                  background: hoveredClose === tab.key ? "var(--bg-hover)" : "transparent",
                  border: "none", borderRadius: 4,
                  color: hoveredClose === tab.key ? "var(--text)" : "var(--text-dim)",
                  cursor: "pointer",
                  transition: "background 0.1s, color 0.1s",
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
