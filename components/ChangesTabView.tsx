"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, GitMerge, Spinner } from "@phosphor-icons/react";
import type { GitStatusResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import { ChangeRow, fetchGitStatus } from "./QuickChangesPanel";

interface Props {
  /** Directory whose working-tree changes are reviewed. */
  cwd: string;
  /** Drill-down into one file: opens a file tab in diff mode, reusing the
   *  FileViewer's diff rendering instead of duplicating it here. */
  onOpenFile: (filePath: string, fileName: string, options?: { initialDisplayMode?: "diff" }) => void;
  /** Open the git graph tab for this workspace. */
  onOpenGraph?: (cwd: string) => void;
}

/**
 * Full-surface changes review tab for the right panel: every working-tree
 * change of `cwd` in one list, with per-file diff drill-down. The compact
 * QuickChangesPanel in the sidebar stays as the indicator; this tab is where
 * the actual review happens.
 */
export function ChangesTabView({ cwd, onOpenFile, onOpenGraph }: Props) {
  const { t } = useI18n();
  const [gitStatus, setGitStatus] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadGitStatus = useCallback(async () => {
    setLoading(true);
    try {
      setGitStatus(await fetchGitStatus(cwd));
    } catch {
      setGitStatus(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadGitStatus();
  }, [loadGitStatus]);

  const hasFiles = gitStatus?.isGitRepository && gitStatus.files.length > 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", textAlign: "left" }}>
          {t("desktop.changesWorkingTree")}
        </span>
        {hasFiles && (
          <>
            <span style={{ marginLeft: 6, flexShrink: 0, color: "var(--git-status-added)", fontFamily: "var(--font-mono)", fontSize: 11 }}>+{gitStatus.additions}</span>
            <span style={{ marginLeft: 5, flexShrink: 0, color: "var(--git-status-deleted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>-{gitStatus.deletions}</span>
          </>
        )}
        {onOpenGraph && (
          <button
            type="button"
            onClick={() => onOpenGraph(cwd)}
            title={t("desktop.gitGraphOpenView")}
            aria-label={t("desktop.gitGraphOpenView")}
            className="panel-icon-btn"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, padding: 0, marginLeft: 5, border: "none", borderRadius: 5, cursor: "pointer", flexShrink: 0 }}
          >
            <GitMerge size={13} weight="regular" aria-hidden="true" style={{ transform: "scaleY(-1)" }} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void loadGitStatus()}
          disabled={loading}
          title={t("desktop.refresh")}
          aria-label={t("desktop.refresh")}
          className="panel-icon-btn"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, padding: 0, border: "none", borderRadius: 5, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.55 : 1, flexShrink: 0 }}
        >
          {loading
            ? <Spinner size={12} style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true" />
            : <ArrowClockwise size={13} weight="regular" aria-hidden="true" />}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "2px 4px 4px" }}>
        {gitStatus === null ? null : !gitStatus.isGitRepository ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("desktop.gitNotRepository")}
          </div>
        ) : gitStatus.files.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("desktop.changesEmpty")}
          </div>
        ) : (
          gitStatus.files.map((status) => (
            <ChangeRow key={status.filePath} status={status} cwd={cwd} onOpenFile={onOpenFile} />
          ))
        )}
      </div>
    </div>
  );
}
