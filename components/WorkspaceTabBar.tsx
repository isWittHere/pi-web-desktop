"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { WorkspacePickerMenu } from "./WorkspacePickerMenu";
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
  /** The currently active workspace key (highlight in the picker). */
  selectedProject: string | null;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  /** A project was picked from the "+" menu — open it as a tab. */
  onSelectProject: (project: string) => void;
}

function pathBaseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function WorkspaceTabBar({
  tabs,
  activeKey,
  activity,
  projects,
  selectedProject,
  onSelectTab,
  onCloseTab,
  onSelectProject,
}: WorkspaceTabBarProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [homeDir, setHomeDir] = useState("");
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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
        style={{
          display: "flex",
          alignItems: "stretch",
          height: "100%",
          minWidth: 0,
          flex: 1,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          const running = activity.get(tab.key)?.running ?? 0;
          return (
            <div
              key={tab.key}
              onClick={() => onSelectTab(tab.key)}
              title={tab.cwd}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: "100%",
                padding: "0 4px 0 10px",
                borderRight: "1px solid var(--border)",
                background: isActive ? "var(--bg-selected)" : "transparent",
                color: isActive ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
                maxWidth: 200,
                minWidth: 60,
                flexShrink: 0,
                userSelect: "none",
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
              {tab.branch && tab.branch !== "main" && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    color: isActive ? "var(--text-dim)" : "var(--text-dim)",
                    maxWidth: 72,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {tab.branch}
                </span>
              )}
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
                <X size={10} aria-hidden="true" />
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
            selectedProject={selectedProject}
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
