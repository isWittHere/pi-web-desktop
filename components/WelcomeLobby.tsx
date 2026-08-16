"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Lightning } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useWorkspaceActions } from "@/hooks/useWorkspaceActions";
import { getSessionList } from "@/lib/session-list";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { RunningSessionIndicator, UnreadSessionIndicator } from "@/components/SessionActivityIndicators";
import { PiLogo } from "@/components/PiLogo";
import type { SessionInfo } from "@/lib/types";
import type { RecentProject, RecentProjectSource } from "@/lib/recent-projects";

/**
 * Welcome lobby — the home page shown while no workspace is open.
 *
 * Three layout-equal sections in one grid: the left column stacks
 * "New workspace" (the picker actions) above "Recent workspaces";
 * "Recommended workspaces" takes the right column. Each column scrolls
 * independently.
 * 1. New workspace: the same two actions as the picker menus — select a
 *    folder (native picker on desktop, inline path input in the browser)
 *    and create/quick-open a scratch workspace. Always visible, even when
 *    both lists are empty (fresh installs).
 * 2. Pi workspaces: pi's own recent workspaces, each project's last-session
 *    activity as its timestamp. Derived from the shared /api/sessions cache
 *    (same dedupe-by-project-root logic as the sidebar) so no extra request
 *    is made on a cold start.
 * 3. Recommended workspaces: recent projects detected from other editors and
 *    coding agents (VS Code family, Zed, Claude Code, Codex, OpenCode) via
 *    GET /api/recent-projects. Shown honestly — no filtering against pi's own
 *    workspaces, no "already added" markers. Toggleable in settings
 *    (localStorage pi-recent-projects-enabled, default on).
 *
 * Each list hides entirely when empty. Selecting any item routes through the
 * same workspace-open chain as the picker menus (requestWorkspaceSwitch →
 * cwd validation → allow-list).
 */

export const RECOMMENDED_ENABLED_KEY = "pi-recent-projects-enabled";

function sourceLabel(source: RecentProjectSource): string {
  switch (source) {
    case "vscode": return "VS Code";
    case "zed": return "Zed";
    case "claude": return "Claude";
    case "codex": return "Codex";
    case "opencode": return "OpenCode";
  }
}

/** Pi workspace with its latest session activity time, plus the up-to-three
 *  sessions from the last week shown inline under the top-3 workspaces. */
interface PiWorkspace {
  path: string;
  modifiedMs: number;
  /** Latest sessions within the last 7 days, newest first (max 3). */
  weekSessions: SessionInfo[];
}

function pathBaseName(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? p;
}

export function WelcomeLobby({
  activity,
  onSelectProject,
  onSelectSession,
}: {
  /** Per-workspace running/unread counts for list-item indicators. */
  activity: Map<string, { running: number; unread: number }>;
  /** Opens the given project through the normal workspace-open chain. */
  onSelectProject: (project: string) => void;
  /** Opens a specific session (inline session rows under the top workspaces). */
  onSelectSession?: (session: SessionInfo) => void;
}) {
  const { t } = useI18n();
  const [recommended, setRecommended] = useState<RecentProject[] | null>(null);
  const [recommendedEnabled, setRecommendedEnabled] = useState(true);
  const [piWorkspaces, setPiWorkspaces] = useState<PiWorkspace[]>([]);
  const {
    openFolderPicker,
    openQuickWorkspace,
    commitCustomPath,
    cancelCustomPath,
    customPathOpen,
    customPathValue,
    setCustomPathValue,
    customPathError,
    setCustomPathError,
    customPathValidating,
    customPathInputRef,
  } = useWorkspaceActions(onSelectProject);

  // Pi's own recent workspaces with timestamps: dedupe by project root,
  // latest session activity per root, sorted newest first. Uses the shared
  // /api/sessions cache (already fetched at startup by the sidebar), so the
  // lobby adds no extra round-trip.
  useEffect(() => {
    let cancelled = false;
    getSessionList()
      .then((data) => {
        if (cancelled) return;
        const weekAgoMs = Date.now() - 7 * 86400000;
        const sessionsByRoot = new Map<string, SessionInfo[]>();
        const latestByRoot = new Map<string, string>(); // root -> modified
        for (const s of data.sessions) {
          const root = s.projectRoot ?? s.cwd;
          if (!root) continue;
          const prev = latestByRoot.get(root);
          if (!prev || s.modified > prev) latestByRoot.set(root, s.modified);
          const list = sessionsByRoot.get(root);
          if (list) list.push(s);
          else sessionsByRoot.set(root, [s]);
        }
        const weekSessions = (root: string): SessionInfo[] =>
          (sessionsByRoot.get(root) ?? [])
            .filter((s) => Date.parse(s.modified) >= weekAgoMs)
            .sort((a, b) => b.modified.localeCompare(a.modified))
            .slice(0, 3);
        setPiWorkspaces(
          [...latestByRoot.entries()]
            .sort((a, b) => b[1].localeCompare(a[1]))
            .map(([path, modified]) => ({ path, modifiedMs: Date.parse(modified), weekSessions: weekSessions(path) })),
        );
      })
      .catch(() => {
        if (!cancelled) setPiWorkspaces([]);
      });
    return () => { cancelled = true; };
  }, []);

  // Read the toggle from localStorage after hydration.
  useEffect(() => {
    try {
      setRecommendedEnabled(window.localStorage.getItem(RECOMMENDED_ENABLED_KEY) !== "0");
    } catch {
      // storage unavailable — keep the default
    }
  }, []);

  // Fetch recommended projects once, while the toggle is on.
  useEffect(() => {
    if (!recommendedEnabled) return;
    let cancelled = false;
    fetch("/api/recent-projects")
      .then((r) => r.json().catch(() => ({})) as Promise<{ projects?: RecentProject[] }>)
      .then((data) => {
        if (!cancelled) setRecommended(data.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) setRecommended([]);
      });
    return () => { cancelled = true; };
  }, [recommendedEnabled]);

  const handleToggleRecommended = useCallback(() => {
    setRecommendedEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RECOMMENDED_ENABLED_KEY, next ? "1" : "0");
      } catch {
        // best-effort
      }
      return next;
    });
  }, []);

  const hasPiProjects = piWorkspaces.length > 0;
  const hasRecommended = recommendedEnabled && (recommended?.length ?? 0) > 0;

  const listItem = (path: string, opts: { source?: RecentProjectSource; timeMs?: number | null; running?: number; unread?: number }) => (
    <button
      key={opts.source ? `${opts.source}:${path}` : `pi:${path}`}
      onClick={() => onSelectProject(path)}
      title={path}      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "5px 8px",
        background: "transparent",
        border: "none",
        borderRadius: 6,
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        minWidth: 0,
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {pathBaseName(path)}
      </span>
      {((opts.running ?? 0) > 0 || (opts.unread ?? 0) > 0) && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {(opts.running ?? 0) > 0 && (
            <span title={t("desktop.agentRunning")} style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--accent)", fontSize: 10, lineHeight: 1 }}>
              <RunningSessionIndicator />
              {(opts.running ?? 0) > 1 && <span>{(opts.running ?? 0)}</span>}
            </span>
          )}
          {(opts.unread ?? 0) > 0 && (
            <span title={t("desktop.newActivity")} style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--accent)", fontSize: 10, lineHeight: 1 }}>
              <UnreadSessionIndicator />
              {(opts.unread ?? 0) > 1 && <span>{(opts.unread ?? 0)}</span>}
            </span>
          )}
        </span>
      )}
      {opts.source && (
        <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)" }}>
          {sourceLabel(opts.source)}
        </span>
      )}
      {opts.timeMs != null && (
        <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)" }}>
          {formatRelativeTime(opts.timeMs, t)}
        </span>
      )}
    </button>
  );

  const sessionItem = (s: SessionInfo, workspacePath: string) => (
    <button
      key={`s:${s.id}`}
      onClick={() => (onSelectSession ? onSelectSession(s) : onSelectProject(workspacePath))}
      title={s.path}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "3px 8px",
        background: "transparent",
        border: "none",
        borderRadius: 6,
        color: "var(--text-muted)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        minWidth: 0,
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {s.name ?? s.firstMessage}
      </span>
      <span style={{ flexShrink: 0, fontSize: 10.5, color: "var(--text-dim)" }}>
        {formatRelativeTime(Date.parse(s.modified), t)}
      </span>
    </button>
  );

  const listHeader = (label: string) => (
    <div style={{
      padding: "0 8px 6px",
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-dim)",
      textTransform: "uppercase",
      letterSpacing: "0.07em",
    }}>
      {label}
    </div>
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflow: "hidden",
        padding: "32px 24px 20px",
        boxSizing: "border-box",
      }}
    >
      {/* Brand — fixed, never scrolls away. */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <div style={{ color: "var(--accent)" }}>
          <PiLogo size={52} />
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", maxWidth: 420, textAlign: "center", lineHeight: 1.6 }}>
          {t("desktop.lobbySubtitle")}
        </div>
      </div>

      {/* Sections — every section is a layout-equal grid cell. The left
          column stacks "New workspace" above "Recent workspaces"; the
          recommended list takes the right column. Each column scrolls
          independently of the other and of the brand. */}
      <div style={{
        flex: 1,
        minHeight: 0,
        width: "min(100%, 940px)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
        gridAutoRows: "1fr",
        justifyContent: "center",
        gap: "20px 44px",
      }}>
        {/* Left column: new workspace (always) + recent workspaces. */}
        <div style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* New workspace — its own section, always visible even when both
              lists are empty. Same hook and behavior as the picker menus' actions. */}
          <div style={{ flexShrink: 0 }}>
            {listHeader(t("desktop.newWorkspace"))}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px" }}>
              <button
                type="button"
                onClick={() => void openFolderPicker()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 18px",
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; }}
              >
                <FolderOpen size={15} weight="regular" aria-hidden="true" />
                {t("desktop.selectFolder")}
              </button>
              <button
                type="button"
                onClick={() => void openQuickWorkspace()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 12px",
                  background: "transparent",
                  border: "none",
                  borderRadius: 8,
                  color: "var(--text-muted)",
                  fontSize: 12.5,
                  cursor: "pointer",
                  transition: "color 0.12s, background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
              >
                <Lightning size={15} weight="regular" aria-hidden="true" />
                {t("desktop.quickWorkspace")}
              </button>
            </div>
            {/* Browser fallback: an inline path input (same as the picker menu). */}
            {customPathOpen && (
              <div style={{ padding: "10px 8px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  ref={customPathInputRef}
                  value={customPathValue}
                  onChange={(e) => { setCustomPathValue(e.target.value); setCustomPathError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void commitCustomPath(); }
                    if (e.key === "Escape") cancelCustomPath();
                  }}
                  placeholder={t("desktop.projectPathPlaceholder")}
                  style={{ width: "100%", maxWidth: 380, fontSize: 12, fontFamily: "var(--font-mono)", padding: "7px 10px", border: "1px solid var(--accent)", borderRadius: 6, outline: "none", background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }}
                />
                {customPathError && (
                  <div style={{ color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{customPathError}</div>
                )}
                <div style={{ display: "flex", gap: 8, maxWidth: 380 }}>
                  <button
                    type="button"
                    onClick={() => void commitCustomPath()}
                    disabled={customPathValidating || !customPathValue.trim()}
                    style={{ flex: 1, padding: "6px 0", background: "var(--accent)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 600, cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer", opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1 }}
                  >
                    {customPathValidating ? t("desktop.checking") : t("desktop.open")}
                  </button>
                  <button
                    type="button"
                    onClick={cancelCustomPath}
                    style={{ flex: 1, padding: "6px 0", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}
                  >
                    {t("desktop.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {hasPiProjects && (
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
              {listHeader(t("desktop.recentProjects"))}
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {piWorkspaces.slice(0, 10).map((w, i) => {
                  const a = activity.get(w.path);
                  return (
                    <div key={w.path}>
                      {listItem(w.path, { running: a?.running ?? 0, unread: a?.unread ?? 0, timeMs: w.modifiedMs })}
                      {/* The top-3 workspaces expand their latest sessions
                          (max 3, only those from the last 7 days). */}
                      {i < 3 && w.weekSessions.length > 0 && (
                        <div style={{ margin: "1px 0 3px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 1 }}>
                          {w.weekSessions.map((s) => sessionItem(s, w.path))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {hasRecommended && (
          <div style={{ minWidth: 0, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
              {listHeader(t("desktop.recommendedWorkspaces"))}
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {(recommended ?? []).slice(0, 14).map((r) => listItem(r.path, { source: r.source, timeMs: r.timeMs }))}
              </div>
              <button
                type="button"
                onClick={handleToggleRecommended}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 6,
                  padding: "4px 8px",
                  background: "transparent",
                  border: "none",
                  borderRadius: 6,
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  transition: "color 0.12s, background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "transparent"; }}
              >
                {t("desktop.hideRecommendedWorkspaces")}
              </button>
            </div>
          )}
        </div>
    </div>
  );
}
