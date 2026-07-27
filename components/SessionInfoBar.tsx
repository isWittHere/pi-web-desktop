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
  SpeakerHigh,
  SpeakerSlash,
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
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
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
  soundEnabled,
  onSoundToggle,
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

  return (
    <div className="session-info-bar">
      {/* Left: completion sound + full history + system prompt */}
      {onSoundToggle && (
        <button
          type="button"
          className="session-info-bar-button"
          onClick={onSoundToggle}
          title={soundEnabled ? translate("disableCompletionSound") : translate("enableCompletionSound")}
          aria-label={soundEnabled ? translate("disableCompletionSound") : translate("enableCompletionSound")}
        >
          {soundEnabled ? <SpeakerHigh size={13} /> : <SpeakerSlash size={13} />}
        </button>
      )}
      {hasSession && (
        <button
          type="button"
          className="session-info-bar-button"
          onClick={onViewFullHistory}
          title={translate("viewFullHistory")}
          aria-label={translate("viewFullHistory")}
        >
          <ClockCounterClockwise size={13} aria-hidden="true" />
        </button>
      )}
      {hasSystemPrompt && (
        <button
          type="button"
          className={`session-info-bar-button${activePanel === "system" ? " is-active" : ""}`}
          onClick={() => setActivePanel((cur) => (cur === "system" ? null : "system"))}
          title={translate("systemPrompt")}
          aria-label={translate("systemPrompt")}
          aria-pressed={activePanel === "system"}
        >
          <FileText size={13} aria-hidden="true" />
        </button>
      )}

      {/* Spacer */}
      <div className="session-info-bar-spacer" />

      {/* Compact button */}
      {onCompact && (
        <div className="session-info-bar-compact-wrap">
          {compactError && (
            <div className="session-info-bar-compact-error">{compactError}</div>
          )}
          <button
            type="button"
            className={`session-info-bar-button${isCompacting ? " is-compacting" : ""}`}
            onClick={isCompacting ? onAbortCompaction : onCompact}
            title={isCompacting ? translate("stopCompaction") : translate("compactContext")}
            aria-label={isCompacting ? translate("stopCompaction") : translate("compactContext")}
          >
            {isCompacting ? <Square size={13} /> : <ArrowsIn size={13} />}
          </button>
        </div>
      )}

      {/* Token stats */}
      {hasStats && (
        <button
          type="button"
          className={`session-info-bar-button is-stats${activePanel === "session" ? " is-active" : ""}`}
          onClick={() => setActivePanel((cur) => (cur === "session" ? null : "session"))}
          title={tooltip || translate("sessionInfo")}
          aria-label={translate("sessionInfo")}
          aria-pressed={activePanel === "session"}
        >
          {t && t.input > 0 && (
            <span className="session-info-bar-token-chip">
              <ArrowUp size={10} aria-hidden="true" />
              {formatTokenCount(t.input)}
            </span>
          )}
          {t && t.output > 0 && (
            <span className="session-info-bar-token-chip">
              <ArrowDown size={10} aria-hidden="true" />
              {formatTokenCount(t.output)}
            </span>
          )}
          {t && t.cacheRead > 0 && (
            <span className="session-info-bar-token-chip">
              <Database size={10} aria-hidden="true" />
              {formatTokenCount(t.cacheRead)}
            </span>
          )}
          {costStr && <span>{costStr}</span>}
          {ctxStr && (
            <span className="session-info-bar-token-chip" style={{ color: ctxColor }}>
              <Gauge size={10} aria-hidden="true" />
              {ctxStr}
            </span>
          )}
        </button>
      )}

      {/* Popover: system prompt */}
      {activePanel === "system" && (
        <>
          <div className="session-info-bar-popover-cover" onClick={closePanel} />
          <div className="session-info-bar-popover is-system">
            <div className="session-info-bar-popover-header">
              <span className="session-info-bar-popover-title">
                {translate("systemPrompt")}
              </span>
              <button
                type="button"
                className="session-info-bar-popover-close"
                onClick={closePanel}
              >
                ✕
              </button>
            </div>
            <div className="session-info-bar-popover-body">
              {systemPrompt || (
                <span className="session-info-bar-popover-empty">
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
          <div className="session-info-bar-popover-cover" onClick={closePanel} />
          <div className="session-info-bar-popover is-session">
            <div className="session-stats-body">
              {(() => {
                const tok = sessionStats.tokens;
                const ctx = contextUsage ?? sessionStats.contextUsage;

                const copyBtn = (field: SessionCopyField, val: string) => {
                  const copied = copiedField === field;
                  return (
                    <button
                      type="button"
                      className={`session-stats-copy${copied ? " is-copied" : ""}`}
                      title={copied ? translate("copied") : field === "file" ? translate("copyFilePath") : translate("copySessionId")}
                      onClick={() => handleCopyField(field, val)}
                    >
                      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                    </button>
                  );
                };

                // ── Session Info rows (direct display, no labels) ──
                const sessionInfoRows: React.ReactNode[] = [];
                if (sessionStats.sessionName) {
                  sessionInfoRows.push(
                    <div key="name" className="session-stats-info-name">{sessionStats.sessionName}</div>,
                  );
                }
                sessionInfoRows.push(
                  <div key="file" className="session-stats-info-line">
                    <span className="session-stats-info-text">
                      {sessionStats.sessionFile ? (sessionStats.sessionFile.split(/[/\\]/).pop() ?? sessionStats.sessionFile) : translate("sessionInfoInMemory")}
                    </span>
                    {sessionStats.sessionFile ? copyBtn("file", sessionStats.sessionFile) : null}
                  </div>,
                );
                sessionInfoRows.push(
                  <div key="id" className="session-stats-info-line">
                    <span className="session-stats-info-text">
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

                const row = (label: string, val: string) => (
                  <div key={label} className="session-stats-row">
                    <div className="session-stats-label">{label}</div>
                    <div className="session-stats-value">{val}</div>
                  </div>
                );

                return (
                  <>
                    {/* Session Info — direct display */}
                    <div className="session-stats-info-block">
                      {sessionInfoRows}
                    </div>

                    {/* Messages + Tokens side-by-side */}
                    <div className="session-stats-side-by-side">
                      <div className="session-stats-column">
                        <div className="session-stats-section-title">{translate("sessionInfoMessages")}</div>
                        <div className="session-stats-compact-grid">
                          {msgRows.map(([label, val]) => row(label, val))}
                        </div>
                      </div>
                      <div className="session-stats-column">
                        <div className="session-stats-section-title">{translate("sessionInfoTokens")}</div>
                        <div className="session-stats-compact-grid">
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
