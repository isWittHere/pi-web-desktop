"use client";

import { BranchNavigator } from "./BranchNavigator";
import { useElectronWindow } from "@/hooks/useElectronWindow";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
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
  selectedSession: SessionInfo | null;
  onViewFullHistory: () => void;
  branchTree: SessionTreeNode[];
  branchActiveLeafId: string | null;
  onBranchLeafChange: (leafId: string | null) => void;
  systemBtnRef: React.RefObject<HTMLButtonElement | null>;
  systemPrompt: string | null;
  activeTopPanel: "branches" | "system" | "session" | null;
  onToggleTopPanel: (panel: "branches" | "system" | "session") => void;
  topPanelPos: { top: number; left: number; width: number } | null;
  sessionStats: SessionStatsInfo | null;
  contextUsage: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  copiedSessionField: SessionCopyField | null;
  onCopySessionField: (field: SessionCopyField, value: string) => void;
  rightPanelOpen: boolean;
  onToggleFilePanel: () => void;
  workspaceTitle: string | null;
  onWorkspaceControlsHostChange?: (node: HTMLDivElement | null) => void;
}

export function AppTitleBar({
  topBarRef,
  sidebarOpen,
  onSidebarToggle,
  isDark,
  toggleTheme,
  isMobile,
  showChat,
  selectedSession,
  onViewFullHistory,
  branchTree,
  branchActiveLeafId,
  onBranchLeafChange,
  systemBtnRef,
  systemPrompt,
  activeTopPanel,
  onToggleTopPanel,
  topPanelPos,
  sessionStats,
  contextUsage,
  copiedSessionField,
  onCopySessionField,
  rightPanelOpen,
  onToggleFilePanel,
  workspaceTitle,
  onWorkspaceControlsHostChange,
}: AppTitleBarProps) {
  const { isElectron, isMaximized, minimize, toggleMaximize, close } = useElectronWindow();

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
        {/* Sidebar toggle */}
        <button
          className="app-no-drag"
          onClick={onSidebarToggle}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          {sidebarOpen ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>

        {/* Theme toggle */}
        <button
          className="app-no-drag"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
          }}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-pressed={isDark}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          {isDark ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <div
          className="app-no-drag"
          ref={onWorkspaceControlsHostChange}
          style={{
            flex: "0 1 590px",
            minWidth: 180,
            maxWidth: 640,
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: "0 8px 0 2px",
          }}
        />

        {showChat && (
          <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
            {/* Full history */}
            <button
              className="app-no-drag"
              onClick={onViewFullHistory}
              disabled={!selectedSession}
              title={selectedSession ? "View full history" : "Full history is available after the session is saved"}
              aria-label="View full history"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                padding: 0,
                background: "none",
                border: "none",
                color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                cursor: selectedSession ? "pointer" : "not-allowed",
                opacity: selectedSession ? 1 : 0.45,
                flexShrink: 0,
                transition: "color 0.12s, opacity 0.1s",
              }}
              onMouseEnter={(e) => {
                if (!selectedSession) return;
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>

            {/* Branch navigator */}
            <BranchNavigator
              tree={branchTree}
              activeLeafId={branchActiveLeafId}
              onLeafChange={onBranchLeafChange}
              inline
              containerRef={topBarRef}
              open={activeTopPanel === "branches"}
              onToggle={() => onToggleTopPanel("branches")}
              hasSession
            />

            {/* System prompt */}
            <button
              className="app-no-drag"
              ref={systemBtnRef}
              onClick={() => onToggleTopPanel("system")}
              title="System prompt"
              aria-label="System prompt"
              aria-pressed={activeTopPanel === "system"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, padding: 0,
                background: activeTopPanel === "system" ? "var(--bg-selected)" : "none",
                border: "none",
                borderTop: activeTopPanel === "system" ? "2px solid var(--accent)" : "2px solid transparent",
                cursor: "pointer",
                color: activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)",
                flexShrink: 0,
                transition: "color 0.12s, background 0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)"; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="13" y2="17" />
              </svg>
            </button>
          </div>
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
          {workspaceTitle && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {workspaceTitle}
            </span>
          )}
        </div>

        {/* Session stats — right-aligned */}
        {showChat && (sessionStats || contextUsage) && (() => {
          const t = sessionStats?.tokens;
          const c = sessionStats?.cost ?? 0;
          const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
          const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;

          let ctxColor = "var(--text-muted)";
          let ctxStr: string | null = null;
          if (contextUsage?.contextWindow) {
            const pct = contextUsage.percent;
            if (pct !== null && pct > 90) ctxColor = "#ef4444";
            else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.95)";
            ctxStr = pct !== null ? `${pct.toFixed(0)}% / ${fmt(contextUsage.contextWindow)}` : `? / ${fmt(contextUsage.contextWindow)}`;
          }

          const tooltipParts: string[] = [];
          if (t) {
            tooltipParts.push(`in: ${t.input.toLocaleString()}`);
            tooltipParts.push(`out: ${t.output.toLocaleString()}`);
            tooltipParts.push(`cache read: ${t.cacheRead.toLocaleString()}`);
            tooltipParts.push(`cache write: ${t.cacheWrite.toLocaleString()}`);
            if (c > 0) tooltipParts.push(`cost: $${c.toFixed(4)}`);
          }
          if (contextUsage?.contextWindow) {
            const pct = contextUsage.percent;
            tooltipParts.push(`context: ${pct !== null ? pct.toFixed(1) + "%" : "unknown"} of ${contextUsage.contextWindow.toLocaleString()} tokens`);
          }
          const tooltip = tooltipParts.join("  |  ");

          return (
            <button
              className="app-no-drag"
              type="button"
              onClick={() => onToggleTopPanel("session")}
              title={tooltip || "Session info"}
              aria-label="Session info"
              aria-pressed={activeTopPanel === "session"}
              style={{
                marginLeft: "auto",
                display: "flex", alignItems: "center", gap: 10,
                paddingLeft: 12,
                paddingRight: 12,
                height: "100%",
                background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
                border: "none",
                borderTop: activeTopPanel === "session" ? "2px solid var(--accent)" : "2px solid transparent",
                fontSize: 11, color: "var(--text-muted)",
                whiteSpace: "nowrap", cursor: "pointer",
                fontVariantNumeric: "tabular-nums",
                transition: "color 0.1s, background 0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)"; }}
            >
              {isMobile && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              )}
              {!isMobile && t && t.input > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                  </svg>
                  {fmt(t.input)}
                </span>
              )}
              {!isMobile && t && t.output > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                  </svg>
                  {fmt(t.output)}
                </span>
              )}
              {!isMobile && t && t.cacheRead > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3"/>
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                  </svg>
                  {fmt(t.cacheRead)}
                </span>
              )}
              {!isMobile && costStr && (
                <span style={{ display: "flex", alignItems: "center", color: "var(--text)", fontWeight: 500 }}>
                  {costStr}
                </span>
              )}
              {ctxStr && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor }}>
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" />
                  </svg>
                  {ctxStr}
                </span>
              )}
            </button>
          );
        })()}

        {/* File panel toggle */}
        <button
          className="app-no-drag"
          onClick={onToggleFilePanel}
          title={rightPanelOpen ? "Hide file panel" : "Show file panel"}
          aria-label={rightPanelOpen ? "Hide file panel" : "Show file panel"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: "none", border: "none",
            borderTop: rightPanelOpen ? "2px solid var(--accent)" : "2px solid transparent",
            color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>

        {/* Window controls (Electron only) */}
        {isElectron && (
          <div style={{ display: "flex", alignItems: "stretch", height: "100%", flexShrink: 0 }}>
            <button
              className="app-no-drag"
              onClick={minimize}
              title="Minimize"
              aria-label="Minimize"
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="5" y1="13" x2="19" y2="13" />
              </svg>
            </button>
            <button
              className="app-no-drag"
              onClick={toggleMaximize}
              title={isMaximized ? "Restore" : "Maximize"}
              aria-label={isMaximized ? "Restore" : "Maximize"}
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
              {isMaximized ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="7" width="10" height="10" rx="1" />
                  <path d="M9 5h7a2 2 0 0 1 2 2v7" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="1" />
                </svg>
              )}
            </button>
            <button
              className="app-no-drag"
              onClick={close}
              title="Close"
              aria-label="Close"
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
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
            <div className="session-info-popover" style={{
              background: "var(--bg-panel)",
              borderBottom: "1px solid var(--border)",
              boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
              padding: "12px 16px",
            }}>
              {sessionStats ? (() => {
                const sessionRows = [
                  ...(sessionStats.sessionName ? [{ label: "Name", value: sessionStats.sessionName, copyField: null }] : []),
                  { label: "File", value: sessionStats.sessionFile ?? "In-memory", copyField: "file" as const },
                  { label: "ID", value: sessionStats.sessionId, copyField: "id" as const },
                ];
                const messageRows = [
                  ["User", sessionStats.userMessages.toLocaleString()],
                  ["Assistant", sessionStats.assistantMessages.toLocaleString()],
                  ["Tool Calls", sessionStats.toolCalls.toLocaleString()],
                  ["Tool Results", sessionStats.toolResults.toLocaleString()],
                  ["Total", sessionStats.totalMessages.toLocaleString()],
                ];
                const tokenRows = [
                  ["Input", sessionStats.tokens.input.toLocaleString()],
                  ["Output", sessionStats.tokens.output.toLocaleString()],
                  ...(sessionStats.tokens.cacheRead > 0 ? [["Cache Read", sessionStats.tokens.cacheRead.toLocaleString()]] : []),
                  ...(sessionStats.tokens.cacheWrite > 0 ? [["Cache Write", sessionStats.tokens.cacheWrite.toLocaleString()]] : []),
                  ["Total", sessionStats.tokens.total.toLocaleString()],
                ];
                const ctx = contextUsage ?? sessionStats.contextUsage;
                const formatCompact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                const extraTokenRows = [
                  ...(sessionStats.cost > 0 ? [["Cost", `$${sessionStats.cost.toFixed(4)}`]] : []),
                  ...(ctx?.contextWindow ? [["Context", `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`]] : []),
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
                      title={copied ? "Copied" : `Copy ${field === "file" ? "file path" : "session ID"}`}
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
                      {copied ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  );
                };
                const sessionInfoSection = (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Session Info</div>
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
                    {section("Messages", messageRows)}
                    {section("Tokens", [...tokenRows, ...extraTokenRows], "right", true)}
                  </div>
                );
              })() : (
                <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                  Send a message or run /session to load session info
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}