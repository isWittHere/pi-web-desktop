"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchResponse } from "@/lib/session-search";

// Sidebar session-search overlay: while active it replaces the session list
// with literal-text hits across the current project's indexed sessions
// (scoped by the optional `project` root, same grouping as the sidebar list).
// Selecting a hit opens the session and jumps to the matched entry/block.
export function SessionSearch({ open, query, project, refreshKey, children, selectedSessionId, onSelectSession }: {
  open: boolean;
  query: string;
  /** Project-root scope; unset (no workspace) searches every workspace. */
  project?: string | null;
  refreshKey: number | null;
  children: ReactNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, entryId?: string, blockIndex?: number) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<{ query: string; response?: SessionSearchResponse; failed?: boolean }>({ query: "" });
  const search = query.trim();
  const response = state.query === search ? state.response : undefined;
  const failed = state.query === search && state.failed;

  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    setState({ query: search });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sessions/search?${new URLSearchParams({ q: search, ...(project ? { project } : {}) })}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as SessionSearchResponse;
        if (!controller.signal.aborted) setState({ query: search, response: data });
      } catch {
        if (!controller.signal.aborted) setState({ query: search, failed: true });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search, project, refreshKey]);

  if (!open || !search) return <>{children}</>;

  return (
    <div style={{ minHeight: 80, flex: 1, overflowY: "auto" }} aria-busy={!response && !failed}>
      <div role="status" style={{ padding: "8px 12px 2px", fontSize: 11, color: "var(--text-muted)" }}>
        {failed ? t("desktop.sessionSearchFailed") : !response ? t("desktop.sessionSearching")
          : response.results.length === 0 ? t("desktop.sessionSearchEmpty")
          : t("desktop.sessionSearchCount", { count: response.results.length, suffix: response.results.length === 1 ? "" : "s" })}
      </div>
      {response?.truncated && (
        <div role="status" style={{ padding: "0 12px 8px", fontSize: 11, color: "var(--text-muted)" }}>
          {t("desktop.sessionSearchPartial")}
        </div>
      )}
      {response?.results.map(({ session, entryId, blockIndex, before, match, after }) => (
        <button
          key={session.id}
          type="button"
          onClick={() => onSelectSession(session, entryId, blockIndex)}
          aria-current={session.id === selectedSessionId ? "true" : undefined}
          style={{
            display: "block",
            width: "100%",
            cursor: "pointer",
            border: 0,
            borderBottom: "1px solid var(--border)",
            background: session.id === selectedSessionId ? "var(--bg-selected)" : "transparent",
            padding: "8px 12px",
            textAlign: "left",
            color: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = session.id === selectedSessionId ? "var(--bg-selected)" : "transparent"; }}
        >
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
            {session.name || session.firstMessage}
          </span>
          <span style={{ marginTop: 2, display: "flex", minWidth: 0, gap: 8, fontSize: 10, color: "var(--text-dim)" }}>
            <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={session.cwd}>{session.cwd}</span>
            <span style={{ flexShrink: 0 }}>{formatRelativeTime(session.modified, t)}</span>
          </span>
          <span style={{ marginTop: 3, display: "block", fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere", color: "var(--text-muted)" }}>
            {before}<mark style={{ borderRadius: 2, background: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--text)", padding: "0 1px" }}>{match}</mark>{after}
          </span>
        </button>
      ))}
    </div>
  );
}
