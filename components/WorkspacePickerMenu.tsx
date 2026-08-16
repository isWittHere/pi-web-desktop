"use client";

import { useCallback, useRef, useState } from "react";
import {
  Check,
  FolderOpen,
  Lightning,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { RunningSessionIndicator, UnreadSessionIndicator } from "@/components/SessionActivityIndicators";

/**
 * Shared workspace picker menu — the project search + recent/quick project
 * list + quick-workspace/custom-path actions. Used by the classic title-bar
 * selector, the welcome-page selector and the tabs view "+" menu, so every
 * entry point behaves identically.
 *
 * The menu owns its own search and custom-path input state, so multiple menu
 * instances (title bar + welcome page) never interfere. Parent dropdowns
 * unmount the menu when closed, which resets that transient state.
 */

interface WorkspacePickerMenuProps {
  /** All projects sorted by recent activity (unfiltered). */
  projects: string[];
  /** Currently selected project (classic selector highlight). Omit in tabs
   *  view mode — the picker opens workspaces, it does not single-select. */
  selectedProject?: string | null;
  /** Per-workspace running/unread counts for the list-item indicators. */
  activity: Map<string, { running: number; unread: number }>;
  homeDir: string;
  /** Called with the resolved project path whenever one is chosen
   *  (recent project, quick workspace or a validated custom path). */
  onSelectProject: (project: string) => void;
  /** Called when the user presses Escape with an empty search box. */
  onRequestClose?: () => void;
}

function pathBaseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** True for quick workspaces created by the default-cwd endpoint as
 *  ~/pi-cwd-<YYYYMMDD> (same shape the server uses to seed the allow-list). */
function isQuickWorkspace(cwd: string, homeDir?: string): boolean {
  if (!homeDir) return false;
  const normalizedCwd = cwd.replace(/\\/g, "/");
  const normalizedHome = homeDir.replace(/\\/g, "/");
  if (!normalizedCwd.startsWith(normalizedHome)) return false;
  const firstSegment = normalizedCwd.slice(normalizedHome.length).replace(/^\/+/, "").split("/")[0] ?? "";
  return /^pi-cwd-\d{8}$/.test(firstSegment);
}

export function WorkspacePickerMenu({
  projects,
  selectedProject,
  activity,
  homeDir,
  onSelectProject,
  onRequestClose,
}: WorkspacePickerMenuProps) {
  const { t } = useI18n();
  const [projectFilter, setProjectFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const customPathInputRef = useRef<HTMLInputElement>(null);

  const selectProject = useCallback((project: string) => {
    setProjectFilter("");
    setCustomPathOpen(false);
    setCustomPathValue("");
    setCustomPathError(null);
    onSelectProject(project);
  }, [onSelectProject]);

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setCustomPathOpen(false);
      setCustomPathValue("");
      selectProject(data.cwd ?? path);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating, selectProject]);

  const handleCustomPathClick = useCallback(async () => {
    const desktop = window.piDesktop;
    if (!desktop) {
      setCustomPathOpen(true);
      setCustomPathError(null);
      setTimeout(() => customPathInputRef.current?.focus(), 0);
      return;
    }

    try {
      setCustomPathError(null);
      const path = await desktop.selectDirectory();
      if (path === null) return;

      setCustomPathValue(path);
      setCustomPathOpen(true);
      await commitCustomPath(path);
    } catch (e) {
      setCustomPathOpen(true);
      setCustomPathError(e instanceof Error ? e.message : String(e));
      setTimeout(() => customPathInputRef.current?.focus(), 0);
    }
  }, [commitCustomPath]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        selectProject(data.cwd);
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
      }
    } catch {
      // ignore
    }
  }, [selectProject]);

  const visibleProjects = projectFilter.trim()
    ? projects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : projects;
  const quickProjects = visibleProjects.filter((p) => isQuickWorkspace(p, homeDir));

  const projectSearch = (
    <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <MagnifyingGlass size={13} color="var(--text-dim)" style={{ position: "absolute", left: 12, pointerEvents: "none" }} aria-hidden="true" />
        <input
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (projectFilter) setProjectFilter("");
              else onRequestClose?.();
            }
          }}
          placeholder={t("desktop.searchProjects")}
          aria-label={t("desktop.searchProjects")}
          autoFocus
          style={{ width: "100%", padding: "8px 12px 8px 34px", background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
        />
      </div>
    </div>
  );

  const projectGroupHeader = (label: string) => (
    <div style={{ padding: "5px 8px 3px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
  );

  const projectItem = (project: string) => {
    const isSelected = project === selectedProject;
    const isQuick = isQuickWorkspace(project, homeDir);
    const entry = activity.get(project);
    const runningCount = entry?.running ?? 0;
    const unreadCount = entry?.unread ?? 0;
    return (
      <button key={project} onClick={() => selectProject(project)} title={project} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "3px 8px", background: isSelected ? "var(--bg-selected)" : "transparent", border: "none", borderRadius: 5, color: isSelected ? "var(--accent)" : "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12, fontFamily: "var(--font-mono)", minWidth: 0 }} onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
        {isQuick ? (
          <Lightning size={12} color={isSelected ? "var(--accent)" : "var(--text-dim)"} weight={isSelected ? "fill" : "regular"} style={{ flexShrink: 0 }} aria-hidden="true" />
        ) : isSelected ? (
          <Check size={12} color="var(--accent)" weight="bold" style={{ flexShrink: 0 }} aria-hidden="true" />
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pathBaseName(project)}</span>
        {(runningCount > 0 || unreadCount > 0) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            {runningCount > 0 && (
              <span title={t("desktop.agentRunning")} style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--accent)", fontSize: 10, lineHeight: 1 }}>
                <RunningSessionIndicator />
                {runningCount > 1 && <span>{runningCount}</span>}
              </span>
            )}
            {unreadCount > 0 && (
              <span title={t("desktop.newActivity")} style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--accent)", fontSize: 10, lineHeight: 1 }}>
                <UnreadSessionIndicator />
                {unreadCount > 1 && <span>{unreadCount}</span>}
              </span>
            )}
          </span>
        )}
      </button>
    );
  };

  const projectList = (
    <div style={{ maxHeight: "min(calc(32vh / var(--app-ui-scale, 1)), 240px)", overflowY: "auto", flex: 1, minHeight: 0, padding: "4px" }}>
      {visibleProjects.length > 0 && (
        <>
          {projectGroupHeader(t("desktop.recentProjects"))}
          {visibleProjects.map(projectItem)}
        </>
      )}
      {quickProjects.length > 0 && (
        <>
          {projectGroupHeader(t("desktop.quickWorkspaces"))}
          {quickProjects.map(projectItem)}
        </>
      )}
      {visibleProjects.length === 0 && <div style={{ padding: "8px", fontSize: 12, color: "var(--text-dim)" }}>{projectFilter.trim() ? t("desktop.noMatchingProjects") : t("desktop.noProjectsYet")}</div>}
    </div>
  );

  const projectActions = (
    <div style={{ borderTop: "1px solid var(--border)", padding: "4px", flexShrink: 0 }}>
      <button onClick={(e) => { e.stopPropagation(); void handleDefaultCwd(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", background: "transparent", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12 }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}>
        <Lightning size={14} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
        <span>{t("desktop.quickWorkspace")}</span>
      </button>
      {!customPathOpen ? (
        <button onClick={(e) => { e.stopPropagation(); void handleCustomPathClick(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", background: "transparent", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12 }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}>
          <FolderOpen size={14} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
          <span>{t("desktop.selectFolder")}</span>
        </button>
      ) : (
        <div style={{ padding: "6px 4px 4px" }}>
          <input ref={customPathInputRef} value={customPathValue} onChange={(e) => { setCustomPathValue(e.target.value); setCustomPathError(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commitCustomPath(); } if (e.key === "Escape") { setCustomPathOpen(false); setCustomPathValue(""); setCustomPathError(null); } }} placeholder={t("desktop.projectPathPlaceholder")} style={{ width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", padding: "5px 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }} />
          {customPathError && <div style={{ marginTop: 5, color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{customPathError}</div>}
          <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
            <button onClick={() => void commitCustomPath()} disabled={customPathValidating || !customPathValue.trim()} style={{ flex: 1, padding: "4px 0", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer", opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1 }}>{customPathValidating ? t("desktop.checking") : t("desktop.open")}</button>
            <button onClick={() => { setCustomPathOpen(false); setCustomPathValue(""); setCustomPathError(null); }} style={{ flex: 1, padding: "4px 0", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>{t("desktop.cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {projectSearch}
      {projectList}
      {projectActions}
    </>
  );
}
