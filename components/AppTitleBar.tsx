"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Gear,
  List,
  Minus,
  Moon,
  Plus,
  SidebarSimple,
  Square,
  Sun,
  X,
} from "@phosphor-icons/react";
import { useElectronWindow } from "@/hooks/useElectronWindow";
import { useI18n } from "@/hooks/useI18n";
import { WorkspacePickerMenu } from "./WorkspacePickerMenu";
import { TitleBarDismissOverlay } from "./TitleBarDismissOverlay";
import type { SessionStatsInfo } from "@/lib/pi-types";

type SessionCopyField = "file" | "id";

interface AppTitleBarProps {
  topBarRef: React.RefObject<HTMLDivElement | null>;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  isDark: boolean;
  toggleTheme: (origin?: { x: number; y: number }) => void;
  isMobile: boolean;
  showChat: boolean;
  systemPrompt: string | null;
  activeTopPanel: "system" | "session" | null;

  topPanelPos: { top: number; left: number; width: number } | null;
  sessionStats: SessionStatsInfo | null;
  contextUsage: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  copiedSessionField: SessionCopyField | null;
  onCopySessionField: (field: SessionCopyField, value: string) => void;
  rightPanelOpen: boolean;
  onToggleFilePanel: () => void;
  onOpenSettings: () => void;
  sessionTitle: string | null;
  /** True when the title-bar title is hidden (tabs mode with 4+ tabs): the
   *  workspace host expands to reclaim the title's space, and the drag
   *  region shrinks to a fixed strip so the window stays draggable. */
  expandWorkspaceHost?: boolean;
  /** True while the selected session's title is being regenerated. */
  titleGenerating?: boolean;
  onWorkspaceControlsHostChange?: (node: HTMLDivElement | null) => void;
  /** Tabs view mode: show the workspace "+" button pinned right after the
   *  sidebar toggle (fixed, never pushed out by the tab strip). */
  showWorkspaceAddButton?: boolean;
  /** Projects + per-workspace activity for the "+" picker menu (reported by
   *  the sidebar, same snapshot the tab bar consumes). */
  pickerProjects?: string[];
  pickerActivity?: Map<string, { running: number; unread: number }>;
  /** A project was picked from the "+" menu — open it as a workspace tab. */
  onSelectProject?: (project: string) => void;
}

/** Renders a placeholder icon until mounted, then the correct theme icon.
 *  Avoids SSR hydration mismatch caused by the server always defaulting
 *  to dark mode while the client inline script restores a stored preference. */
function ThemeToggleButton({
  isDark,
  toggleTheme,
  translate,
}: {
  isDark: boolean;
  toggleTheme: (origin?: { x: number; y: number }) => void;
  translate: (key: string) => string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const title = mounted
    ? (isDark ? translate("desktop.switchToLight") : translate("desktop.switchToDark"))
    : translate("desktop.switchToLight"); // SSR default: dark mode

  return (
    <button
      className="app-no-drag"
      suppressHydrationWarning
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      title={title}
      aria-label={title}
      aria-pressed={mounted ? isDark : true}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 36, height: 36, padding: 0,
        background: "none", border: "none",
        color: "var(--text-muted)", cursor: "pointer", flexShrink: 0,
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
    >
      {mounted
        ? (isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />)
        : <Sun size={16} aria-hidden="true" />
      }
    </button>
  );
}

export function AppTitleBar({
  topBarRef,
  sidebarOpen,
  onSidebarToggle,
  isDark,
  toggleTheme,
  isMobile,
  showChat,
  systemPrompt,
  activeTopPanel,

  topPanelPos,
  sessionStats,
  contextUsage,
  copiedSessionField,
  onCopySessionField,
  rightPanelOpen,
  onToggleFilePanel,
  onOpenSettings,
  sessionTitle,
  expandWorkspaceHost = false,
  titleGenerating = false,
  onWorkspaceControlsHostChange,
  showWorkspaceAddButton = false,
  pickerProjects = [],
  pickerActivity,
  onSelectProject,
}: AppTitleBarProps) {
  const { isElectron, isMac, isMaximized, minimize, toggleMaximize, close } = useElectronWindow();
  const { t: translate } = useI18n();
  // Workspace "+" picker button state (pinned left, next to the sidebar
  // toggle in tabs view mode).
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [homeDir, setHomeDir] = useState("");
  const addButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  // Close the "+" menu on outside click (the picker owns its own transient
  // search/custom-path state and resets when unmounted).
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addButtonRef.current?.contains(e.target as Node)) return;
      setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addMenuOpen]);

  const handleAddProject = (project: string) => {
    setAddMenuOpen(false);
    onSelectProject?.(project);
  };

  return (
    <>
      {/* Full-width app title bar — drag region for frameless Electron */}
      <div
        ref={topBarRef}
        className="app-title-bar"
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          borderBottom: "1px solid var(--border)",
          height: 36,
          background: "var(--bg-panel)",
          position: "relative",
          zIndex: 600,
        }}
        onDoubleClick={(e) => {
          // Double-click title bar to toggle maximize (only in Electron)
          if (!isElectron) return;
          const target = e.target as HTMLElement;
          if (target.closest("button, a, input, select, textarea")) return;
          toggleMaximize();
        }}
      >
        {/* macOS traffic-light buttons live in the native title bar area; reserve
            space on the left so they don't overlap the sidebar toggle. */}
        {isMac && <div aria-hidden="true" style={{ width: 72, flexShrink: 0 }} />}

        {/* Sidebar toggle */}
        <button
          className="app-no-drag"
          onClick={onSidebarToggle}
          title={sidebarOpen ? translate("desktop.hideSidebar") : translate("desktop.showSidebar")}
          aria-label={sidebarOpen ? translate("desktop.hideSidebar") : translate("desktop.showSidebar")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: sidebarOpen ? "var(--bg-selected)" : "none", border: "none",
            color: sidebarOpen ? "var(--text)" : "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = sidebarOpen ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = sidebarOpen ? "var(--text)" : "var(--text-muted)"; }}
        >
          {sidebarOpen ? <SidebarSimple size={16} aria-hidden="true" /> : <List size={16} aria-hidden="true" />}
        </button>

        {/* Workspace "+" picker — pinned next to the sidebar toggle (tabs
            view mode), so it is never pushed out of view by the tab strip.
            The dropdown anchors below the button. */}
        {showWorkspaceAddButton && (
          <div
            ref={addButtonRef}
            style={{ position: "relative", flexShrink: 0 }}
          >
            <button
              className="app-no-drag"
              onClick={() => setAddMenuOpen((v) => !v)}
              title={translate("desktop.newWorkspaceTab")}
              aria-label={translate("desktop.newWorkspaceTab")}
              aria-expanded={addMenuOpen}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, padding: 0,
                background: addMenuOpen ? "var(--bg-selected)" : "none", border: "none",
                color: addMenuOpen ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer", flexShrink: 0, transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = addMenuOpen ? "var(--bg-selected)" : "none";
                e.currentTarget.style.color = addMenuOpen ? "var(--text)" : "var(--text-muted)";
              }}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
            {addMenuOpen && <TitleBarDismissOverlay />}
            {addMenuOpen && (
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
                  projects={pickerProjects}
                  activity={pickerActivity ?? new Map()}
                  homeDir={homeDir}
                  onSelectProject={handleAddProject}
                  onRequestClose={() => setAddMenuOpen(false)}
                />
              </div>
            )}
          </div>
        )}

        <div
          className="app-no-drag"
          ref={onWorkspaceControlsHostChange}
          style={{
            // Expanded (title hidden): the host reclaims the title's space
            // AND the drag handle's — the tab strip's empty area becomes
            // the drag region itself (browser-style), so no fixed handle
            // reservation is needed.
            flex: expandWorkspaceHost ? "1 1 0" : "0 1 auto",
            minWidth: 0,
            maxWidth: expandWorkspaceHost ? "none" : "min(calc(52vw / var(--app-ui-scale, 1)), 560px)",
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: "0 8px 0 0",
            overflow: "visible",
          }}
        />

        {showChat && (
          <div style={{ display: "flex", alignItems: "stretch", height: "100%" }} />
        )}

        {/* Flexible title spacer; in Electron this is the primary drag area.
            With an expanded workspace host the spacer is removed entirely —
            the tab strip's empty area takes over as the drag region, so the
            tabs get every remaining pixel. */}
        <div
          className="app-title-drag"
          style={{
            flex: expandWorkspaceHost ? "0 0 0" : 1,
            display: expandWorkspaceHost ? "none" : "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            minWidth: 0,
            padding: "0 12px",
            userSelect: "none",
          }}
        >
          {sessionTitle && (
            <span
              className={titleGenerating ? "session-title-generating" : undefined}
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {sessionTitle}
            </span>
          )}
        </div>



        {/* File panel toggle */}
        <button
          className="app-no-drag"
          onClick={onToggleFilePanel}
          title={rightPanelOpen ? translate("desktop.hideFilePanel") : translate("desktop.showFilePanel")}
          aria-label={rightPanelOpen ? translate("desktop.hideFilePanel") : translate("desktop.showFilePanel")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: rightPanelOpen ? "var(--bg-selected)" : "none", border: "none",
            color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer", flexShrink: 0, transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = rightPanelOpen ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
        >
          <SidebarSimple size={16} aria-hidden="true" style={{ transform: "scaleX(-1)" }} />
        </button>

        {/* Theme toggle — defer render until client mount to avoid
            SSR hydration mismatch on icon and attributes. */}
        <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} translate={translate} />

        {/* Settings */}
        <button
          className="app-no-drag"
          type="button"
          onClick={onOpenSettings}
          title={translate("desktop.settings")}
          aria-label={translate("desktop.settings")}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <Gear size={16} aria-hidden="true" />
        </button>

        {/* Window controls (Electron only; macOS uses native traffic lights) */}
        {isElectron && !isMac && (
          <div style={{ display: "flex", alignItems: "stretch", height: "100%", flexShrink: 0 }}>
            <button
              className="app-no-drag"
              onClick={minimize}
              title={translate("desktop.minimize")}
              aria-label={translate("desktop.minimize")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 44, height: "100%", padding: 0,
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            <button
              className="app-no-drag"
              onClick={toggleMaximize}
              title={isMaximized ? translate("desktop.restore") : translate("desktop.maximize")}
              aria-label={isMaximized ? translate("desktop.restore") : translate("desktop.maximize")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 44, height: "100%", padding: 0,
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
            >
              {isMaximized ? <Copy size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
            </button>
            <button
              className="app-no-drag"
              onClick={close}
              title={translate("desktop.close")}
              aria-label={translate("desktop.close")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 44, height: "100%", padding: 0,
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "#e81123"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "none"; }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Dropdown panel — fixed position, full width below title bar */}
      {activeTopPanel && topPanelPos && (
        <div style={{
          position: "fixed",
          top: topPanelPos.top,
          left: topPanelPos.left,
          width: topPanelPos.width,
          maxHeight: `calc(100dvh / var(--app-ui-scale, 1) - ${topPanelPos.top}px)`,
          overflowY: "auto",
          zIndex: 500,
        }}>
          {activeTopPanel === "system" && (
            <div style={{
              background: "var(--bg-panel)",
              borderBottom: "1px solid var(--border)",
            }}>
              {systemPrompt ? (
                <div style={{
                  maxHeight: "min(600px, calc(75vh / var(--app-ui-scale, 1)))",
                  overflowY: "auto",
                  padding: "12px 16px",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-mono)",
                }}>
                  {systemPrompt}
                </div>
              ) : systemPrompt === "" ? (
                <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                  System prompt is empty (tools are disabled)
                </div>
              ) : (
                <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                  Send a message to load the system prompt
                </div>
              )}
            </div>
          )}
          {activeTopPanel === "session" && (
            <div style={{
              background: "var(--bg-panel)",
              borderBottom: "1px solid var(--border)",
              boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
              padding: "12px 16px",
            }}>
              {sessionStats ? (() => {
                const sessionRows = [
                  ...(sessionStats.sessionName ? [{ label: translate("desktop.name"), value: sessionStats.sessionName, copyField: null }] : []),
                  { label: translate("desktop.sessionInfoFile"), value: sessionStats.sessionFile ?? translate("desktop.sessionInfoInMemory"), copyField: "file" as const },
                  { label: translate("desktop.sessionInfoId"), value: sessionStats.sessionId, copyField: "id" as const },
                ];
                const messageRows = [
                  [translate("desktop.sessionInfoUser"), sessionStats.userMessages.toLocaleString()],
                  [translate("desktop.sessionInfoAssistant"), sessionStats.assistantMessages.toLocaleString()],
                  [translate("desktop.sessionInfoToolCalls"), sessionStats.toolCalls.toLocaleString()],
                  [translate("desktop.sessionInfoToolResults"), sessionStats.toolResults.toLocaleString()],
                  [translate("desktop.sessionInfoTotal"), sessionStats.totalMessages.toLocaleString()],
                ];
                const tokenRows = [
                  [translate("desktop.sessionInfoInput"), sessionStats.tokens.input.toLocaleString()],
                  [translate("desktop.sessionInfoOutput"), sessionStats.tokens.output.toLocaleString()],
                  ...(sessionStats.tokens.cacheRead > 0 ? [[translate("desktop.sessionInfoCacheRead"), sessionStats.tokens.cacheRead.toLocaleString()]] : []),
                  ...(sessionStats.tokens.cacheWrite > 0 ? [[translate("desktop.sessionInfoCacheWrite"), sessionStats.tokens.cacheWrite.toLocaleString()]] : []),
                  [translate("desktop.sessionInfoTotal"), sessionStats.tokens.total.toLocaleString()],
                ];
                const ctx = contextUsage ?? sessionStats.contextUsage;
                const formatCompact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                const extraTokenRows = [
                  ...(sessionStats.cost > 0 ? [[translate("desktop.sessionInfoCost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
                  ...(ctx?.contextWindow ? [[translate("desktop.sessionInfoContext"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`]] : []),
                ];
                const section = (
                  title: string,
                  sectionRows: string[][],
                  valueAlign: "left" | "right" = "left",
                  compact = false,
                ) => (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
                      columnGap: compact ? 14 : 12,
                      rowGap: 4,
                      justifyContent: compact ? "start" : undefined,
                    }}>
                      {sectionRows.map(([label, value]) => (
                        <div key={`${title}:${label}`} style={{ display: "contents" }}>
                          <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
                          <div style={{
                            color: "var(--text-muted)",
                            minWidth: 0,
                            overflowWrap: compact ? "normal" : "anywhere",
                            textAlign: valueAlign,
                            whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                          }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
                const copyButton = (field: SessionCopyField, value: string) => {
                  const copied = copiedSessionField === field;
                  return (
                    <button
                      type="button"
                      title={copied ? translate("desktop.copied") : field === "file" ? translate("desktop.copyFilePath") : translate("desktop.copySessionId")}
                      onClick={() => onCopySessionField(field, value)}
                      style={{
                        alignSelf: "start",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 22,
                        height: 22,
                        marginTop: -2,
                        color: copied ? "var(--accent)" : "var(--text-dim)",
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        cursor: "pointer",
                        flex: "0 0 auto",
                        transition: "color 0.12s, border-color 0.12s, background 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--accent)";
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = copied ? "var(--accent)" : "var(--text-dim)";
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                    </button>
                  );
                };
                const sessionInfoSection = (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{translate("desktop.sessionInfoTitle")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                      {sessionRows.map((row) => (
                        <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
                          <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                          <div style={{
                            color: "var(--text-muted)",
                            minWidth: 0,
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                            whiteSpace: "normal",
                          }}>{row.value}</div>
                          <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );

                return (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "1fr"
                      : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                    gap: isMobile ? 16 : 24,
                    fontSize: 12,
                    lineHeight: 1.5,
                    fontFamily: "var(--font-mono)",
                  }}>
                    {sessionInfoSection}
                    {section(translate("desktop.sessionInfoMessages"), messageRows)}
                    {section(translate("desktop.sessionInfoTokens"), [...tokenRows, ...extraTokenRows], "right", true)}
                  </div>
                );
              })() : (
                <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                  {translate("desktop.sendMessageForSessionInfo")}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}