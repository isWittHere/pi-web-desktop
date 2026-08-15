"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { WorkspacePickerMenu } from "./WorkspacePickerMenu";
import { TitleBarDismissOverlay } from "./TitleBarDismissOverlay";
import type { WorkspaceTab } from "@/lib/workspace-tabs";

/**
 * Browser-style workspace tab bar for the tabs view mode, rendered into the
 * title-bar workspace host. One tab per opened workspace (project root when
 * known, else cwd); the trailing "+" opens the shared workspace picker menu.
 * Closing a tab never touches sessions or tasks — it only removes the
 * bookmark (the workspace stays reachable through the picker).
 */

interface WorkspaceTabBarProps {
  tabs: WorkspaceTab[];
  activeKey: string | null;
  /** Per-workspace running/unread counts (tab dot + picker indicators). */
  activity: Map<string, { running: number; unread: number }>;
  /** All projects sorted by recent activity (unfiltered). */
  projects: string[];
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  /** Browser-style drag reorder: move `fromKey` before/after `targetKey`. */
  onReorderTab: (fromKey: string, targetKey: string, position: "before" | "after") => void;
  /** A project was picked from the "+" menu — open it as a tab. */
  onSelectProject: (project: string) => void;
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

export function WorkspaceTabBar({
  tabs,
  activeKey,
  activity,
  projects,
  onSelectTab,
  onCloseTab,
  onReorderTab,
  onSelectProject,
}: WorkspaceTabBarProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [homeDir, setHomeDir] = useState("");
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  // HTML5 drag & drop state: the tab being dragged and the drop indicator
  // (insertion line) relative to the hovered tab. The mousedown that starts
  // the drag happens on the no-drag tab strip, so the Electron window drag
  // region never intercepts the session.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; position: "before" | "after" } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  // Close the "+" menu on outside click (the picker owns its own transient
  // search/custom-path state and resets when unmounted).
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // While the "+" menu is open, cover the Electron title bar with a
  // non-drag overlay: Chromium swallows mousedown on -webkit-app-region:
  // drag areas, so outside-click dismissal would never fire for clicks on
  // the empty title bar. The overlay dispatches the click normally and
  // forwards it to buttons underneath (see TitleBarDismissOverlay).

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
    alignItems: "stretch",
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
      ref={rootRef}
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
                height: "100%",
                padding: "0 4px 0 10px",
                ...NO_DRAG_REGION,
                borderLeft: isDropBefore ? "2px solid var(--accent)" : "none",
                borderRight: isDropAfter ? "2px solid var(--accent)" : "1px solid var(--border)",
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
              {running > 0 && (
                <span
                  title={t("desktop.agentRunning")}
                  style={{
                    flexShrink: 0,
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--accent)",
                  }}
                  aria-hidden="true"
                />
              )}
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

      {/* "+" — open the workspace picker */}
      <button
        onClick={() => setMenuOpen((v) => !v)}
        title={t("desktop.newWorkspaceTab")}
        aria-label={t("desktop.newWorkspaceTab")}
        aria-expanded={menuOpen}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 30, height: "100%", padding: 0, flexShrink: 0,
          ...NO_DRAG_REGION,
          background: menuOpen ? "var(--bg-selected)" : "none",
          border: "none",
          color: menuOpen ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = menuOpen ? "var(--bg-selected)" : "none";
          e.currentTarget.style.color = menuOpen ? "var(--text)" : "var(--text-muted)";
        }}
      >
        <Plus size={14} aria-hidden="true" />
      </button>

      {menuOpen && (
        <TitleBarDismissOverlay />
      )}
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: 320,
            zIndex: 1000,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.16)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            maxHeight: "min(calc(38vh / var(--app-ui-scale, 1)), 300px)",
          }}
        >
          <WorkspacePickerMenu
            projects={projects}
            activity={activity}
            homeDir={homeDir}
            onSelectProject={onSelectProject}
            onRequestClose={() => setMenuOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
