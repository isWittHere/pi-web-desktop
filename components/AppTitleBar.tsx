"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Gear,
  List,
  Minus,
  Moon,
  SidebarSimple,
  Square,
  Sun,
  X,
} from "@phosphor-icons/react";
import { useElectronWindow } from "@/hooks/useElectronWindow";
import { useI18n } from "@/hooks/useI18n";
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
  onWorkspaceControlsHostChange?: (node: HTMLDivElement | null) => void;
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
  onWorkspaceControlsHostChange,
}: AppTitleBarProps) {
  const { isElectron, isMac, isMaximized, minimize, toggleMaximize, close } = useElectronWindow();
  const { t: translate } = useI18n();

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

        <div
          className="app-no-drag"
          ref={onWorkspaceControlsHostChange}
          style={{
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: "min(52vw, 560px)",
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

        {/* Flexible title spacer; in Electron this is the primary drag area. */}
        <div
          className="app-title-drag"
          style={{
            flex: 1,
            display: "flex",
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
          maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
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
                  maxHeight: "min(600px, 75vh)",
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