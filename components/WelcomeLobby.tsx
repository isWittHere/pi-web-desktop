"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getSessionList } from "@/lib/session-list";
import type { RecentProject, RecentProjectSource } from "@/lib/recent-projects";

/**
 * Welcome lobby — the home page shown while no workspace is open.
 *
 * Two plain-text lists, placed side by side when space allows and stacked
 * when it does not (flex-wrap):
 * 1. Pi workspaces: pi's own recent workspaces, each project's last-session
 *    activity as its timestamp. Derived from the shared /api/sessions cache
 *    (same dedupe-by-project-root logic as the sidebar) so no extra request
 *    is made on a cold start.
 * 2. Recommended workspaces: recent projects detected from other editors and
 *    coding agents (VS Code family, Zed, Claude Code, Codex, OpenCode) via
 *    GET /api/recent-projects. Shown honestly — no filtering against pi's own
 *    workspaces, no "already added" markers. Toggleable in settings
 *    (localStorage pi-recent-projects-enabled, default on).
 *
 * Each list hides entirely when empty. Selecting any item routes through the
 * same workspace-open chain as the picker menus (requestWorkspaceSwitch →
 * cwd validation → allow-list).
 */

const RECOMMENDED_ENABLED_KEY = "pi-recent-projects-enabled";

function sourceLabel(source: RecentProjectSource): string {
  switch (source) {
    case "vscode": return "VS Code";
    case "zed": return "Zed";
    case "claude": return "Claude";
    case "codex": return "Codex";
    case "opencode": return "OpenCode";
  }
}

function sourceColor(source: RecentProjectSource): string {
  switch (source) {
    case "vscode": return "#3a8fe0";
    case "zed": return "#a885e8";
    case "claude": return "#d97757";
    case "codex": return "#4bb387";
    case "opencode": return "#c9c9c9";
  }
}

/** Pi workspace with its latest session activity time. */
interface PiWorkspace {
  path: string;
  modifiedMs: number;
}

/** Inline Pi logo (same path as public/pi-original.svg). */
function PiLogo({ size = 56 }: { size?: number }) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      style={{ flex: "none", lineHeight: 1 }}
      aria-hidden="true"
    >
      <path clipRule="evenodd" d="M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z" />
      <path d="M17.5 12H23v11h-5.5V12z" />
    </svg>
  );
}

function pathBaseName(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function formatRelativeTime(ms: number, t: (key: string, params?: { [k: string]: string | number }) => string): string {
  let diff = Date.now() - ms;
  if (diff < 0) diff = 0;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return t("desktop.justNow");
  if (mins < 60) return t("desktop.minutesAgo", { count: mins });
  if (hours < 24) return t("desktop.hoursAgo", { count: hours });
  if (days < 7) return t("desktop.daysAgo", { count: days });
  return new Date(ms).toLocaleDateString();
}

export function WelcomeLobby({
  activity,
  onSelectProject,
}: {
  /** Per-workspace running/unread counts for list-item indicators. */
  activity: Map<string, { running: number; unread: number }>;
  /** Opens the given project through the normal workspace-open chain. */
  onSelectProject: (project: string) => void;
}) {
  const { t } = useI18n();
  const [recommended, setRecommended] = useState<RecentProject[] | null>(null);
  const [recommendedEnabled, setRecommendedEnabled] = useState(true);
  const [piWorkspaces, setPiWorkspaces] = useState<PiWorkspace[]>([]);

  // Pi's own recent workspaces with timestamps: dedupe by project root,
  // latest session activity per root, sorted newest first. Uses the shared
  // /api/sessions cache (already fetched at startup by the sidebar), so the
  // lobby adds no extra round-trip.
  useEffect(() => {
    let cancelled = false;
    getSessionList()
      .then((data) => {
        if (cancelled) return;
        const latestByRoot = new Map<string, string>(); // root -> modified
        for (const s of data.sessions) {
          const root = s.projectRoot ?? s.cwd;
          if (!root) continue;
          const prev = latestByRoot.get(root);
          if (!prev || s.modified > prev) latestByRoot.set(root, s.modified);
        }
        setPiWorkspaces(
          [...latestByRoot.entries()]
            .sort((a, b) => b[1].localeCompare(a[1]))
            .map(([path, modified]) => ({ path, modifiedMs: Date.parse(modified) })),
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
  // Nothing to show beyond the brand — keep the page minimal.
  const hasAnySection = hasPiProjects || hasRecommended;

  const listItem = (path: string, opts: { source?: RecentProjectSource; timeMs?: number | null; running?: number; unread?: number }) => (
    <button
      key={opts.source ? `${opts.source}:${path}` : `pi:${path}`}
      onClick={() => onSelectProject(path)}
      title={path}
      style={{
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
      {opts.source && (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: sourceColor(opts.source),
            flexShrink: 0,
            opacity: 0.85,
          }}
          aria-hidden="true"
        />
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {pathBaseName(path)}
      </span>
      {opts.running != null && opts.running > 0 && (
        <span style={{ flexShrink: 0, color: "var(--accent)", fontSize: 10 }} title={t("desktop.agentRunning")} aria-hidden="true">●</span>
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

  const listColumn = (children: React.ReactNode) => (
    <div style={{ flex: "1 1 320px", maxWidth: 440, minWidth: 0 }}>
      {children}
    </div>
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflowY: "auto",
        padding: "32px 24px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: hasAnySection ? 30 : 0 }}>
        <div style={{ color: "var(--accent)" }}>
          <PiLogo size={52} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 650, color: "var(--text)", letterSpacing: "-0.01em" }}>
          {t("desktop.lobbyTitle")}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", maxWidth: 420, textAlign: "center", lineHeight: 1.6 }}>
          {t("desktop.lobbySubtitle")}
        </div>
      </div>

      {hasAnySection && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "flex-start",
          gap: "24px 48px",
          width: "min(100%, 880px)",
        }}>
          {hasPiProjects && listColumn(
            <>
              {listHeader(t("desktop.recentProjects"))}
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {piWorkspaces.slice(0, 10).map((w) => {
                  const a = activity.get(w.path);
                  return listItem(w.path, { running: a?.running ?? 0, unread: a?.unread ?? 0, timeMs: w.modifiedMs });
                })}
              </div>
            </>,
          )}
          {hasRecommended && listColumn(
            <>
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
            </>,
          )}
        </div>
      )}
    </div>
  );
}
