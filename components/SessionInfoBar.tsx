"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowsIn,
  Check,
  ClockCounterClockwise,
  Copy,
  Database,
  FileText,
  Gauge,
  Square,
} from "@phosphor-icons/react";
import { useLanguage } from "@/hooks/useLanguage";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { copyText } from "@/lib/clipboard";
import { useCallback, useRef, useState } from "react";

export interface SessionInfoBarProps {
  onViewFullHistory?: () => void;
  systemPrompt: string | null;
  sessionStats: SessionStatsInfo | null;
  contextUsage: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  hasSession: boolean;
  showChat: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

type SessionCopyField = "file" | "id";

export function SessionInfoBar({
  onViewFullHistory,
  systemPrompt,
  sessionStats,
  contextUsage,
  hasSession,
  showChat,
  onCompact,
  onAbortCompaction,
  isCompacting,
  compactError,
}: SessionInfoBarProps) {
  const { t: translate } = useLanguage();
  const [activePanel, setActivePanel] = useState<"system" | "session" | null>(null);
  const closePanel = useCallback(() => setActivePanel(null), []);

  // Copy state for session file / id
  const [copiedField, setCopiedField] = useState<SessionCopyField | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopyField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      setCopiedField(field);
      copyTimerRef.current = setTimeout(() => setCopiedField(null), 1400);
    });
  }, []);

  if (!showChat) return null;

  const t = sessionStats?.tokens;
  const c = sessionStats?.cost ?? 0;
  const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : "<$0.01") : null;

  let ctxColor = "var(--text-muted)";
  let ctxStr: string | null = null;
  if (contextUsage?.contextWindow) {
    const pct = contextUsage.percent;
    if (pct !== null && pct > 90) ctxColor = "#ef4444";
    else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.95)";
    ctxStr =
      pct !== null
        ? `${pct.toFixed(0)}% / ${formatTokenCount(contextUsage.contextWindow)}`
        : `? / ${formatTokenCount(contextUsage.contextWindow)}`;
  }

  const hasSystemPrompt = systemPrompt !== null && systemPrompt !== "";
  const hasStats = sessionStats && t && (t.input > 0 || t.output > 0);

  // Tooltip for stats button
  const tooltipParts: string[] = [];
  if (t) {
    tooltipParts.push(`${translate("sessionInfoInput")}: ${t.input.toLocaleString()}`);
    tooltipParts.push(`${translate("sessionInfoOutput")}: ${t.output.toLocaleString()}`);
    if (t.cacheRead > 0)
      tooltipParts.push(`${translate("sessionInfoCacheRead")}: ${t.cacheRead.toLocaleString()}`);
    if (t.cacheWrite > 0)
      tooltipParts.push(`${translate("sessionInfoCacheWrite")}: ${t.cacheWrite.toLocaleString()}`);
    if (c > 0) tooltipParts.push(`${translate("sessionInfoCost")}: $${c.toFixed(4)}`);
  }
  if (contextUsage?.contextWindow) {
    const pct = contextUsage.percent;
    tooltipParts.push(
      `${translate("sessionInfoContext")}: ${pct !== null ? `${pct.toFixed(1)}%` : "?"} / ${contextUsage.contextWindow.toLocaleString()}`,
    );
  }
  const tooltip = tooltipParts.join("  |  ");

  const buttonBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 3,
    padding: "1px 6px",
    height: 22,
    background: "none",
    border: "none",
    borderRadius: 4,
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    whiteSpace: "nowrap",
    transition: "background 0.12s, color 0.12s",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: 26,
        fontSize: 11,
        color: "var(--text-muted)",
        fontVariantNumeric: "tabular-nums",
        position: "relative",
      }}
    >
      {/* Left: full history + system prompt */}
      {hasSession && (
        <button
          type="button"
          onClick={onViewFullHistory}
          title={translate("viewFullHistory")}
          aria-label={translate("viewFullHistory")}
          style={buttonBase}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <ClockCounterClockwise size={13} aria-hidden="true" />
        </button>
      )}
      {hasSystemPrompt && (
        <button
          type="button"
          onClick={() => setActivePanel((cur) => (cur === "system" ? null : "system"))}
          title={translate("systemPrompt")}
          aria-label={translate("systemPrompt")}
          aria-pressed={activePanel === "system"}
          style={{
            ...buttonBase,
            background: activePanel === "system" ? "var(--bg-selected)" : "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = activePanel === "system" ? "var(--bg-selected)" : "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = activePanel === "system" ? "var(--bg-selected)" : "none";
            e.currentTarget.style.color = activePanel === "system" ? "var(--text)" : "var(--text-muted)";
          }}
        >
          <FileText size={13} aria-hidden="true" />
        </button>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Compact button */}
      {onCompact && (
        <div style={{ position: "relative" }}>
          {compactError && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 6px)", right: 0,
              background: "#1f2937", color: "#f87171",
              fontSize: 11, padding: "4px 8px", borderRadius: 5,
              whiteSpace: "nowrap", pointerEvents: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)", zIndex: 50,
            }}>
              {compactError}
            </div>
          )}
          <button
            type="button"
            onClick={isCompacting ? onAbortCompaction : onCompact}
            title={isCompacting ? translate("stopCompaction") : translate("compactContext")}
            aria-label={isCompacting ? translate("stopCompaction") : translate("compactContext")}
            style={{
              ...buttonBase,
              color: isCompacting ? "#ef4444" : "var(--text-muted)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.16)" : "var(--bg-hover)";
              e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text-muted)";
            }}
          >
            {isCompacting ? <Square size={13} /> : <ArrowsIn size={13} />}
          </button>
        </div>
      )}

      {/* Token stats */}
      {hasStats && (
        <button
          type="button"
          onClick={() => setActivePanel((cur) => (cur === "session" ? null : "session"))}
          title={tooltip || translate("sessionInfo")}
          aria-label={translate("sessionInfo")}
          aria-pressed={activePanel === "session"}
          style={{
            ...buttonBase,
            gap: 5,
            background: activePanel === "session" ? "var(--bg-selected)" : "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = activePanel === "session" ? "var(--bg-selected)" : "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = activePanel === "session" ? "var(--bg-selected)" : "none";
            e.currentTarget.style.color = activePanel === "session" ? "var(--text)" : "var(--text-muted)";
          }}
        >
          {t && t.input > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <ArrowUp size={10} aria-hidden="true" />
              {formatTokenCount(t.input)}
            </span>
          )}
          {t && t.output > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <ArrowDown size={10} aria-hidden="true" />
              {formatTokenCount(t.output)}
            </span>
          )}
          {t && t.cacheRead > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Database size={10} aria-hidden="true" />
              {formatTokenCount(t.cacheRead)}
            </span>
          )}
          {costStr && <span>{costStr}</span>}
          {ctxStr && (
            <span style={{ display: "flex", alignItems: "center", gap: 2, color: ctxColor }}>
              <Gauge size={10} aria-hidden="true" />
              {ctxStr}
            </span>
          )}
        </button>
      )}

      {/* Popover: system prompt */}
      {activePanel === "system" && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 499 }} onClick={closePanel} />
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              right: 0,
              marginBottom: 4,
              zIndex: 500,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              maxWidth: 520,
              width: "max-content",
              maxHeight: 280,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "6px 10px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 11,
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--text)" }}>
                {translate("systemPrompt")}
              </span>
              <button
                type="button"
                onClick={closePanel}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                maxHeight: 220,
                overflowY: "auto",
                padding: "8px 12px",
                color: "var(--text-muted)",
                fontSize: 12,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
              }}
            >
              {systemPrompt || (
                <span style={{ fontStyle: "italic" }}>
                  System prompt is empty (tools are disabled)
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {/* Popover: session stats */}
      {activePanel === "session" && sessionStats && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 499 }} onClick={closePanel} />
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              right: 0,
              marginBottom: 4,
              zIndex: 500,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              minWidth: 320,
              maxWidth: 400,
              overflow: "hidden",
            }}
          >
            {/* Body */}
            <div
              style={{
                padding: "10px 14px",
                fontSize: 12,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {(() => {
                const tok = sessionStats.tokens;
                const ctx = contextUsage ?? sessionStats.contextUsage;

                // Shared styles
                const dim = "var(--text-dim)";
                const labelStyle: React.CSSProperties = { color: dim, whiteSpace: "nowrap" };
                const valueStyle: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap" };
                const sectionTitle: React.CSSProperties = {
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text)",
                  marginBottom: 4,
                };
                const compactGrid: React.CSSProperties = {
                  display: "grid",
                  gridTemplateColumns: "max-content max-content",
                  columnGap: 14,
                  rowGap: 3,
                  justifyContent: "start",
                };
                const row = (label: string, val: string) => (
                  <div key={label} style={{ display: "contents" }}>
                    <div style={labelStyle}>{label}</div>
                    <div style={valueStyle}>{val}</div>
                  </div>
                );

                // Copy button
                const copyBtn = (field: SessionCopyField, val: string) => {
                  const copied = copiedField === field;
                  return (
                    <button
                      type="button"
                      title={copied ? translate("copied") : field === "file" ? translate("copyFilePath") : translate("copySessionId")}
                      onClick={() => handleCopyField(field, val)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 22,
                        height: 22,
                        color: copied ? "var(--accent)" : dim,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        flexShrink: 0,
                        transition: "color 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--accent)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = copied ? "var(--accent)" : dim;
                      }}
                    >
                      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                    </button>
                  );
                };

                // ── Session Info rows (direct display, no labels) ──
                const sessionInfoRows: React.ReactNode[] = [];
                if (sessionStats.sessionName) {
                  sessionInfoRows.push(
                    <div key="name" style={{ ...labelStyle, marginBottom: 4 }}>{sessionStats.sessionName}</div>,
                  );
                }
                sessionInfoRows.push(
                  <div key="file" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{
                      flex: "1 1 auto",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {sessionStats.sessionFile ? (sessionStats.sessionFile.split(/[/\\]/).pop() ?? sessionStats.sessionFile) : translate("sessionInfoInMemory")}
                    </span>
                    {sessionStats.sessionFile ? copyBtn("file", sessionStats.sessionFile) : null}
                  </div>,
                );
                sessionInfoRows.push(
                  <div key="id" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{
                      flex: "1 1 auto",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {sessionStats.sessionId}
                    </span>
                    {copyBtn("id", sessionStats.sessionId)}
                  </div>,
                );

                // ── Messages rows ──
                const msgRows: [string, string][] = [
                  [translate("sessionInfoUser"), sessionStats.userMessages.toLocaleString()],
                  [translate("sessionInfoAssistant"), sessionStats.assistantMessages.toLocaleString()],
                  [translate("sessionInfoToolCalls"), sessionStats.toolCalls.toLocaleString()],
                  [translate("sessionInfoToolResults"), sessionStats.toolResults.toLocaleString()],
                  [translate("sessionInfoTotal"), sessionStats.totalMessages.toLocaleString()],
                ];

                // ── Tokens rows ──
                const tokenRows: [string, string][] = [
                  [translate("sessionInfoInput"), tok.input.toLocaleString()],
                  [translate("sessionInfoOutput"), tok.output.toLocaleString()],
                ];
                if (tok.cacheRead > 0) tokenRows.push([translate("sessionInfoCacheRead"), tok.cacheRead.toLocaleString()]);
                if (tok.cacheWrite > 0) tokenRows.push([translate("sessionInfoCacheWrite"), tok.cacheWrite.toLocaleString()]);
                tokenRows.push([translate("sessionInfoTotal"), tok.total.toLocaleString()]);
                if (sessionStats.cost > 0) tokenRows.push([translate("sessionInfoCost"), `$${sessionStats.cost.toFixed(4)}`]);
                if (ctx?.contextWindow) {
                  const pct = ctx.percent;
                  tokenRows.push([
                    translate("sessionInfoContext"),
                    `${pct !== null ? `${pct.toFixed(1)}%` : "?"} / ${ctx.contextWindow.toLocaleString()}`,
                  ]);
                }

                return (
                  <>
                    {/* Session Info — direct display */}
                    <div style={{ marginBottom: 2 }}>
                      {sessionInfoRows}
                    </div>

                    {/* Messages + Tokens side-by-side */}
                    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
                      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                        <div style={sectionTitle}>{translate("sessionInfoMessages")}</div>
                        <div style={compactGrid}>
                          {msgRows.map(([label, val]) => row(label, val))}
                        </div>
                      </div>
                      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                        <div style={sectionTitle}>{translate("sessionInfoTokens")}</div>
                        <div style={compactGrid}>
                          {tokenRows.map(([label, val]) => row(label, val))}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
