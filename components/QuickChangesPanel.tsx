"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, CaretRight, Spinner } from "@phosphor-icons/react";
import { getFileIcon } from "./FileIcons";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  cwd: string;
  refreshKey?: number;
  onOpenFile: (filePath: string, fileName: string, options?: { initialDisplayMode?: "diff" }) => void;
}

const GIT_STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "#d6a84b",
  added: "#4ade80",
  deleted: "#f87171",
  renamed: "#60a5fa",
  untracked: "#4ade80",
  conflict: "#f87171",
};

async function fetchGitStatus(cwd: string): Promise<GitStatusResponse> {
  const response = await fetch(`/api/git/status?${new URLSearchParams({ cwd }).toString()}`);
  if (!response.ok) throw new Error(`Failed to load Git status (HTTP ${response.status})`);
  return response.json() as Promise<GitStatusResponse>;
}

function ChangeRow({ status, cwd, onOpenFile }: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: Props["onOpenFile"];
}) {
  const [hovered, setHovered] = useState(false);
  const relativePath = getRelativeFilePath(status.filePath, cwd);

  return (
    <button
      type="button"
      onClick={() => onOpenFile(status.filePath, getFileName(status.filePath), { initialDisplayMode: "diff" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={status.filePath}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "0 8px", height: 24, border: "none", borderRadius: 4, background: hovered ? "var(--bg-hover)" : "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ width: 14, flexShrink: 0, color: GIT_STATUS_COLORS[status.status], fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>{status.code}</span>
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.85 }}>{getFileIcon(getFileName(status.filePath), 13)}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontSize: 12 }}>{relativePath}</span>
    </button>
  );
}

export function QuickChangesPanel({ cwd, refreshKey, onOpenFile }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusResponse | null>(null);
  const [gitLoading, setGitLoading] = useState(false);

  const loadGitStatus = useCallback(async () => {
    setGitLoading(true);
    try {
      setGitStatus(await fetchGitStatus(cwd));
    } catch {
      setGitStatus(null);
    } finally {
      setGitLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadGitStatus();
  }, [loadGitStatus, refreshKey]);

  const fileCount = gitStatus?.files.length ?? 0;

  return (
    <section
      style={{
        flex: "0 0 auto",
        minHeight: 0,
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, padding: "6px 10px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "left" }}
        >
          <CaretRight size={9} weight="regular" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} aria-hidden="true" />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("desktop.quickChanges")}</span>
          <span style={{ color: "var(--text-dim)", fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>{t("desktop.changedFiles", { count: fileCount })}</span>
        </button>
        {gitStatus?.isGitRepository && (
          <>
            <span style={{ color: GIT_STATUS_COLORS.added, fontFamily: "var(--font-mono)", fontSize: 11 }}>+{gitStatus.additions}</span>
            <span style={{ color: GIT_STATUS_COLORS.deleted, fontFamily: "var(--font-mono)", fontSize: 11, marginLeft: 5 }}>-{gitStatus.deletions}</span>
          </>
        )}
        <button
          type="button"
          onClick={() => void loadGitStatus()}
          disabled={gitLoading}
          title={t("desktop.refresh")}
          aria-label={t("desktop.refresh")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, padding: 0, marginLeft: 4, marginRight: 6, border: "none", borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: gitLoading ? "wait" : "pointer", opacity: gitLoading ? 0.55 : 1 }}
        >
          {gitLoading ? <Spinner size={12} style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true" /> : <ArrowClockwise size={13} weight="regular" aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <div style={{ minHeight: 0, maxHeight: "min(35vh, 280px)", overflowY: "auto", overflowX: "hidden", padding: "2px 4px 4px" }}>
          {!gitStatus ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{t("desktop.loading")}</div>
          ) : !gitStatus.isGitRepository ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{t("desktop.notAGitRepository")}</div>
          ) : fileCount === 0 ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>{t("desktop.noChanges")}</div>
          ) : (
            gitStatus.files.map((status) => (
              <ChangeRow key={status.filePath} status={status} cwd={cwd} onOpenFile={onOpenFile} />
            ))
          )}
        </div>
      )}
    </section>
  );
}
