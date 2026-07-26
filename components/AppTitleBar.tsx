"use client";

import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Database,
  FileText,
  Gauge,
  Gear,
  Info,
  List,
  Minus,
  Moon,
  SidebarSimple,
  Square,
  Sun,
  X,
} from "@phosphor-icons/react";
import { BranchNavigator } from "./BranchNavigator";
import { useElectronWindow } from "@/hooks/useElectronWindow";
import { useLanguage } from "@/hooks/useLanguage";
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
  onOpenSettings: () => void;
  sessionTitle: string | null;
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
  onOpenSettings,
  sessionTitle,
  onWorkspaceControlsHostChange,
}: AppTitleBarProps) {
  const { isElectron, isMaximized, minimize, toggleMaximize, close } = useElectronWindow();
  const { t: translate } = useLanguage();

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
          title={sidebarOpen ? translate("hideSidebar") : translate("showSidebar")}
          aria-label={sidebarOpen ? translate("hideSidebar") : translate("showSidebar")}
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
          <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
            {/* Full history */}
            <button
              className="app-no-drag"
              onClick={onViewFullHistory}
              disabled={!selectedSession}
              title={selectedSession ? translate("viewFullHistory") : translate("fullHistoryAvailableAfterSave")}
              aria-label={translate("viewFullHistory")}
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
                transition: "background 0.12s, color 0.12s, opacity 0.1s",
              }}
              onMouseEnter={(e) => {
                if (!selectedSession) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
              }}
            >
              <ArrowCounterClockwise size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
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
              title={translate("systemPrompt")}
              aria-label={translate("systemPrompt")}
              aria-pressed={activeTopPanel === "system"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, padding: 0,
                background: activeTopPanel === "system" ? "var(--bg-selected)" : "none",
                border: "none",
                cursor: "pointer",
                color: activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)",
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = activeTopPanel === "system" ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)"; }}
            >
              <FileText size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
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
            tooltipParts.push(`${translate("sessionInfoInput")}: ${t.input.toLocaleString()}`);
            tooltipParts.push(`${translate("sessionInfoOutput")}: ${t.output.toLocaleString()}`);
            tooltipParts.push(`${translate("sessionInfoCacheRead")}: ${t.cacheRead.toLocaleString()}`);
            tooltipParts.push(`${translate("sessionInfoCacheWrite")}: ${t.cacheWrite.toLocaleString()}`);
            if (c > 0) tooltipParts.push(`${translate("sessionInfoCost")}: $${c.toFixed(4)}`);
          }
          if (contextUsage?.contextWindow) {
            const pct = contextUsage.percent;
            tooltipParts.push(`${translate("sessionInfoContext")}: ${pct !== null ? `${pct.toFixed(1)}%` : "?"} / ${contextUsage.contextWindow.toLocaleString()}`);
          }
          const tooltip = tooltipParts.join("  |  ");

          return (
            <button
              className="app-no-drag"
              type="button"
              onClick={() => onToggleTopPanel("session")}
              title={tooltip || translate("sessionInfo")}
              aria-label={translate("sessionInfo")}
              aria-pressed={activeTopPanel === "session"}
              style={{
                marginLeft: "auto",
                display: "flex", alignItems: "center", gap: 8,
                padding: "0 10px",
                height: 36,
                background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
                border: "none",
                fontSize: 12, color: "var(--text-muted)",
                whiteSpace: "nowrap", cursor: "pointer",
                fontVariantNumeric: "tabular-nums",
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = activeTopPanel === "session" ? "var(--bg-selected)" : "none"; e.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)"; }}
            >
              {isMobile && <Info size={16} aria-hidden="true" />}
              {!isMobile && t && t.input > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ArrowUp size={12} aria-hidden="true" />
                  {fmt(t.input)}
                </span>
              )}
              {!isMobile && t && t.output > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ArrowDown size={12} aria-hidden="true" />
                  {fmt(t.output)}
                </span>
              )}
              {!isMobile && t && t.cacheRead > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Database size={12} aria-hidden="true" />
                  {fmt(t.cacheRead)}
                </span>
              )}
              {!isMobile && costStr && (
                <span style={{ display: "flex", alignItems: "center" }}>
                  {costStr}
                </span>
              )}
              {ctxStr && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor }}>
                  <Gauge size={12} aria-hidden="true" />
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
          title={rightPanelOpen ? translate("hideFilePanel") : translate("showFilePanel")}
          aria-label={rightPanelOpen ? translate("hideFilePanel") : translate("showFilePanel")}
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

        {/* Theme toggle */}
        <button
          className="app-no-drag"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
          }}
          title={isDark ? translate("switchToLight") : translate("switchToDark")}
          aria-label={isDark ? translate("switchToLight") : translate("switchToDark")}
          aria-pressed={isDark}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>

        {/* Settings */}
        <button
          className="app-no-drag"
          type="button"
          onClick={onOpenSettings}
          title={translate("settings")}
          aria-label={translate("settings")}
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

        {/* Window controls (Electron only) */}
        {isElectron && (
          <div style={{ display: "flex", alignItems: "stretch", height: "100%", flexShrink: 0 }}>
            <button
              className="app-no-drag"
              onClick={minimize}
              title={translate("minimize")}
              aria-label={translate("minimize")}
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
              title={isMaximized ? translate("restore") : translate("maximize")}
              aria-label={isMaximized ? translate("restore") : translate("maximize")}
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
              title={translate("close")}
              aria-label={translate("close")}
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
                  ...(sessionStats.sessionName ? [{ label: translate("name"), value: sessionStats.sessionName, copyField: null }] : []),
                  { label: translate("sessionInfoFile"), value: sessionStats.sessionFile ?? translate("sessionInfoInMemory"), copyField: "file" as const },
                  { label: translate("sessionInfoId"), value: sessionStats.sessionId, copyField: "id" as const },
                ];
                const messageRows = [
                  [translate("sessionInfoUser"), sessionStats.userMessages.toLocaleString()],
                  [translate("sessionInfoAssistant"), sessionStats.assistantMessages.toLocaleString()],
                  [translate("sessionInfoToolCalls"), sessionStats.toolCalls.toLocaleString()],
                  [translate("sessionInfoToolResults"), sessionStats.toolResults.toLocaleString()],
                  [translate("sessionInfoTotal"), sessionStats.totalMessages.toLocaleString()],
                ];
                const tokenRows = [
                  [translate("sessionInfoInput"), sessionStats.tokens.input.toLocaleString()],
                  [translate("sessionInfoOutput"), sessionStats.tokens.output.toLocaleString()],
                  ...(sessionStats.tokens.cacheRead > 0 ? [[translate("sessionInfoCacheRead"), sessionStats.tokens.cacheRead.toLocaleString()]] : []),
                  ...(sessionStats.tokens.cacheWrite > 0 ? [[translate("sessionInfoCacheWrite"), sessionStats.tokens.cacheWrite.toLocaleString()]] : []),
                  [translate("sessionInfoTotal"), sessionStats.tokens.total.toLocaleString()],
                ];
                const ctx = contextUsage ?? sessionStats.contextUsage;
                const formatCompact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                const extraTokenRows = [
                  ...(sessionStats.cost > 0 ? [[translate("sessionInfoCost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
                  ...(ctx?.contextWindow ? [[translate("sessionInfoContext"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`]] : []),
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
                      title={copied ? translate("copied") : field === "file" ? translate("copyFilePath") : translate("copySessionId")}
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
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{translate("sessionInfoTitle")}</div>
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
                    {section(translate("sessionInfoMessages"), messageRows)}
                    {section(translate("sessionInfoTokens"), [...tokenRows, ...extraTokenRows], "right", true)}
                  </div>
                );
              })() : (
                <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                  {translate("sendMessageForSessionInfo")}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}