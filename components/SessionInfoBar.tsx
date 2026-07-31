"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowsIn,
  BellRinging,
  BellSlash,
  Check,
  ClockCounterClockwise,
  Copy,
  Database,
  FileText,
  GitBranch,
  Square,
} from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SessionTreeNode } from "@/lib/types";
import { copyText } from "@/lib/clipboard";
import { useCallback, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BranchNavigator } from "./BranchNavigator";

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
  branchTree?: SessionTreeNode[];
  branchActiveLeafId?: string | null;
  onBranchLeafChange?: (leafId: string | null) => void;
  /** Show text label alongside the sound icon (e.g. "提示音：开启") */
  showSoundLabel?: boolean;
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
  branchTree,
  branchActiveLeafId,
  onBranchLeafChange,
  showSoundLabel,
}: SessionInfoBarProps) {
  const { t: translate } = useI18n();
  const [activePanel, setActivePanel] = useState<"system" | "session" | "branches" | null>(null);
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

  const systemPromptTokenEstimate = useMemo(() => {
    if (!systemPrompt) return 0;
    let tokens = 0;
    for (const ch of systemPrompt) {
      const code = ch.codePointAt(0) ?? 0;
      if ((code >= 0x4E00 && code <= 0x9FFF) ||
          (code >= 0x3400 && code <= 0x4DBF) ||
          (code >= 0x20000 && code <= 0x2A6DF) ||
          (code >= 0x3040 && code <= 0x309F) ||
          (code >= 0x30A0 && code <= 0x30FF) ||
          (code >= 0xAC00 && code <= 0xD7AF)) {
        tokens += 1;
      } else {
        tokens += 0.25;
      }
    }
    return Math.max(1, Math.round(tokens));
  }, [systemPrompt]);

  if (!showChat) return null;

  const t = sessionStats?.tokens;
  const c = sessionStats?.cost ?? 0;
  const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : "<$0.01") : null;

  let ctxColor = "var(--text-muted)";
  if (contextUsage?.contextWindow) {
    const pct = contextUsage.percent;
    if (pct !== null && pct > 90) ctxColor = "#ef4444";
    else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.95)";
  }

  const hasSystemPrompt = systemPrompt !== null && systemPrompt !== "";
  const hasStats = sessionStats && t && (t.input > 0 || t.output > 0);

  const hasBranching = hasSession && onBranchLeafChange && (() => {
    const tree = branchTree ?? [];
    function check(nodes: SessionTreeNode[]): boolean {
      return nodes.some((node) => node.children.length > 1 || check(node.children));
    }
    return check(tree);
  })();

  // Tooltip for stats button
  const tooltipParts: string[] = [];
  if (t) {
    tooltipParts.push(`${translate("desktop.sessionInfoInput")}: ${t.input.toLocaleString()}`);
    tooltipParts.push(`${translate("desktop.sessionInfoOutput")}: ${t.output.toLocaleString()}`);
    if (t.cacheRead > 0)
      tooltipParts.push(`${translate("desktop.sessionInfoCacheRead")}: ${t.cacheRead.toLocaleString()}`);
    if (t.cacheWrite > 0)
      tooltipParts.push(`${translate("desktop.sessionInfoCacheWrite")}: ${t.cacheWrite.toLocaleString()}`);
    if (c > 0) tooltipParts.push(`${translate("desktop.sessionInfoCost")}: $${c.toFixed(4)}`);
  }
  if (contextUsage?.contextWindow && contextUsage.percent !== null) {
    const pct = contextUsage.percent;
    const used = contextUsage.tokens;
    tooltipParts.push(
      `${translate("desktop.sessionInfoContext")}: ${pct !== null ? `${pct.toFixed(1)}%` : "?"} ${used !== null ? formatTokenCount(used) : "?"}/${formatTokenCount(contextUsage.contextWindow)}`,
    );
  }
  const tooltip = tooltipParts.join("  |  ");

  return (
    <div className="session-info-bar">
      {/* Left: sound / history / branches / system prompt */}
      {onSoundToggle && (
        <button
          type="button"
          className="session-info-bar-button"
          onClick={onSoundToggle}
          title={soundEnabled ? translate("desktop.disableCompletionSound") : translate("desktop.enableCompletionSound")}
          aria-label={soundEnabled ? translate("desktop.disableCompletionSound") : translate("desktop.enableCompletionSound")}
        >
          {soundEnabled ? <BellRinging size={13} /> : <BellSlash size={13} />}
          {showSoundLabel && (
            <span style={{ marginLeft: 4 }}>
              {soundEnabled ? translate("desktop.soundLabelOn") : translate("desktop.soundLabelOff")}
            </span>
          )}
        </button>
      )}
      {hasSession && (
        <button
          type="button"
          className="session-info-bar-button"
          onClick={onViewFullHistory}
          title={translate("desktop.viewFullHistory")}
          aria-label={translate("desktop.viewFullHistory")}
        >
          <ClockCounterClockwise size={13} aria-hidden="true" />
        </button>
      )}

      {/* Branch button + popover (left side) */}
      {hasBranching && (
        <div className="session-info-bar-popover-host">
          <button
            type="button"
            className={`session-info-bar-button${activePanel === "branches" ? " is-active" : ""}`}
            onClick={() => setActivePanel((cur) => (cur === "branches" ? null : "branches"))}
            title={translate("desktop.branches")}
            aria-label={translate("desktop.branches")}
            aria-pressed={activePanel === "branches"}
          >
            <GitBranch size={13} aria-hidden="true" />
          </button>
          {activePanel === "branches" && (
            <>
              <div className="session-info-bar-popover-cover" onClick={closePanel} />
              <div className="session-info-bar-popover is-branches">
                <div className="session-info-bar-popover-header">
                  <span className="session-info-bar-popover-title">
                    {translate("desktop.branches")}
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
                  <BranchNavigator
                    tree={branchTree ?? []}
                    activeLeafId={branchActiveLeafId ?? null}
                    onLeafChange={(id) => {
                      onBranchLeafChange!(id);
                      closePanel();
                    }}
                    hasSession
                    embedded
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* System prompt button + popover (left side) */}
      {hasSystemPrompt && (
        <div className="session-info-bar-popover-host">
          <button
            type="button"
            className={`session-info-bar-button${activePanel === "system" ? " is-active" : ""}`}
            onClick={() => setActivePanel((cur) => (cur === "system" ? null : "system"))}
            title={translate("desktop.systemPrompt")}
            aria-label={translate("desktop.systemPrompt")}
            aria-pressed={activePanel === "system"}
          >
            <FileText size={13} aria-hidden="true" />
          </button>
          {activePanel === "system" && (
            <>
              <div className="session-info-bar-popover-cover" onClick={closePanel} />
              <div className="session-info-bar-popover is-system">
                <div className="session-info-bar-popover-header">
                  <span className="session-info-bar-popover-title">
                    {translate("desktop.systemPrompt")}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 8 }}>
                    ~{formatTokenCount(systemPromptTokenEstimate)} tokens
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="session-info-bar-popover-close"
                    onClick={closePanel}
                  >
                    ✕
                  </button>
                </div>
                <div className="session-info-bar-system-body">
                  {systemPrompt ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {systemPrompt}
                    </ReactMarkdown>
                  ) : (
                    <span className="session-info-bar-popover-empty">
                      System prompt is empty (tools are disabled)
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
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
            title={isCompacting ? translate("desktop.stopCompaction") : translate("desktop.compactContext")}
            aria-label={isCompacting ? translate("desktop.stopCompaction") : translate("desktop.compactContext")}
          >
            {isCompacting ? <Square size={13} /> : <ArrowsIn size={13} />}
          </button>
        </div>
      )}

      {/* Token stats button + popover (right side) */}
      {hasStats && (
        <div className="session-info-bar-popover-host">
          <button
            type="button"
            className={`session-info-bar-button is-stats${activePanel === "session" ? " is-active" : ""}`}
            onClick={() => setActivePanel((cur) => (cur === "session" ? null : "session"))}
            title={tooltip || translate("desktop.sessionInfo")}
            aria-label={translate("desktop.sessionInfo")}
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
            {contextUsage?.contextWindow && contextUsage.percent !== null && (
              <span className="session-info-bar-token-chip" style={{ color: ctxColor }}>
                {/* Pure donut chart — arc length = context usage %. Details are in the tooltip & stats popover. */}
                <svg
                  className="session-info-bar-donut"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="6.75" fill="none" stroke="var(--border)" strokeWidth="2.5" />
                  <circle
                    className="session-info-bar-donut-arc"
                    cx="8"
                    cy="8"
                    r="6.75"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    pathLength={100}
                    strokeDasharray={100}
                    strokeDashoffset={
                      contextUsage.percent === null
                        ? 0 // unknown usage → full ring
                        : 100 - Math.min(100, Math.max(0, contextUsage.percent))
                    }
                    transform="rotate(-90 8 8)"
                  />
                </svg>
              </span>
            )}
          </button>
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
                          title={copied ? translate("desktop.copied") : field === "file" ? translate("desktop.copyFilePath") : translate("desktop.copySessionId")}
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
                          {sessionStats.sessionFile ? (sessionStats.sessionFile.split(/[/\\]/).pop() ?? sessionStats.sessionFile) : translate("desktop.sessionInfoInMemory")}
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
                      [translate("desktop.sessionInfoUser"), sessionStats.userMessages.toLocaleString()],
                      [translate("desktop.sessionInfoAssistant"), sessionStats.assistantMessages.toLocaleString()],
                      [translate("desktop.sessionInfoToolCalls"), sessionStats.toolCalls.toLocaleString()],
                      [translate("desktop.sessionInfoToolResults"), sessionStats.toolResults.toLocaleString()],
                      [translate("desktop.sessionInfoTotal"), sessionStats.totalMessages.toLocaleString()],
                    ];

                    // ── Tokens rows ──
                    const tokenRows: [string, string][] = [
                      [translate("desktop.sessionInfoInput"), tok.input.toLocaleString()],
                      [translate("desktop.sessionInfoOutput"), tok.output.toLocaleString()],
                    ];
                    if (tok.cacheRead > 0) tokenRows.push([translate("desktop.sessionInfoCacheRead"), tok.cacheRead.toLocaleString()]);
                    if (tok.cacheWrite > 0) tokenRows.push([translate("desktop.sessionInfoCacheWrite"), tok.cacheWrite.toLocaleString()]);
                    tokenRows.push([translate("desktop.sessionInfoTotal"), tok.total.toLocaleString()]);
                    if (sessionStats.cost > 0) tokenRows.push([translate("desktop.sessionInfoCost"), `$${sessionStats.cost.toFixed(4)}`]);
                    if (ctx?.contextWindow && ctx.percent !== null) {
                      const pct = ctx.percent;
                      const used = ctx.tokens;
                      tokenRows.push([
                        translate("desktop.sessionInfoContext"),
                        `${pct !== null ? `${pct.toFixed(1)}%` : "?"} ${used !== null ? formatTokenCount(used) : "?"}/${formatTokenCount(ctx.contextWindow)}`,
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
                            <div className="session-stats-section-title">{translate("desktop.sessionInfoMessages")}</div>
                            <div className="session-stats-compact-grid">
                              {msgRows.map(([label, val]) => row(label, val))}
                            </div>
                          </div>
                          <div className="session-stats-column">
                            <div className="session-stats-section-title">{translate("desktop.sessionInfoTokens")}</div>
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
      )}
    </div>
  );
}
