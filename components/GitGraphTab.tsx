"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Spinner, X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { type GitCommitFile, type GitLogResponse } from "@/lib/git-graph";
import { buildGitGraphLayout, type GitGraphEdge, type GitGraphLayout } from "@/lib/git-graph-lanes";
import { deriveLanePalette } from "@/lib/git-graph-palette";

interface Props {
  /** Repository/worktree directory whose history the tab shows. */
  cwd: string;
  /** Open a file mentioned in a commit's changed-file list (source mode). */
  onOpenFile: (filePath: string, fileName: string) => void;
}

const DEFAULT_LIMIT = 400;
const LIMIT_STEP = 400;
const MAX_LIMIT = 2000;

// Geometry (px): row height per commit, lane column width, node radius,
// elbow corner radius, and the gap between graph and text columns.
const ROW_H = 30;
const COL_W = 22;
const NODE_R = 4;
const CORNER_R = 7;
const GRAPH_PAD = 12;
const TEXT_GAP = 10;
const TEXT_WIDTH = 520;

// Commit file status letters → the git status colors the rest of the UI uses.
const COMMIT_CODE_COLORS: Record<string, string> = {
  M: "var(--git-status-modified)",
  R: "var(--git-status-modified)",
  T: "var(--git-status-modified)",
  A: "var(--git-status-added)",
  C: "var(--git-status-added)",
  D: "var(--git-status-deleted)",
  U: "var(--git-status-deleted)",
};

const laneX = (lane: number) => GRAPH_PAD + lane * COL_W + COL_W / 2;
const rowY = (row: number) => row * ROW_H + ROW_H / 2;

function edgePath(edge: GitGraphEdge): string {
  const x1 = laneX(edge.fromLane);
  const y1 = rowY(edge.fromRow);
  const x2 = laneX(edge.toLane);
  const y2 = rowY(edge.toRow);
  if (edge.fromLane === edge.toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const dx = x2 > x1 ? 1 : -1;
  const sy = y2 > y1 ? 1 : -1;
  const r = Math.min(CORNER_R, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  if (edge.kind === "branch") {
    // Horizontal out of the child, rounded corner, vertical into the parent.
    return `M ${x1} ${y1} L ${x2 - dx * r} ${y1} Q ${x2} ${y1} ${x2} ${y1 + sy * r} L ${x2} ${y2}`;
  }
  // merge: vertical out of the child's lane, horizontal into the parent.
  return `M ${x1} ${y1} L ${x1} ${y2 - sy * r} Q ${x1} ${y2} ${x1 + dx * r} ${y2} L ${x2} ${y2}`;
}

function CommitFileRow({ file, cwd, onOpenFile }: {
  file: GitCommitFile;
  cwd: string;
  onOpenFile: Props["onOpenFile"];
}) {
  const [hovered, setHovered] = useState(false);
  const relativePath = getRelativeFilePath(file.filePath, cwd);
  const fileName = getFileName(file.filePath);
  const trailingDirectory = relativePath.endsWith(fileName)
    ? relativePath.slice(0, relativePath.length - fileName.length)
    : null;
  const directoryText = trailingDirectory !== null ? trailingDirectory : relativePath;
  const color = COMMIT_CODE_COLORS[file.code] ?? "var(--git-status-modified)";

  return (
    <button
      type="button"
      onClick={() => onOpenFile(file.filePath, fileName)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={file.filePath}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 4, padding: "0 5px", height: 24, border: "none", borderRadius: 4, background: hovered ? "var(--bg-hover)" : "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12 }}
    >
      <span style={{ width: 14, flexShrink: 0, color, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, textAlign: "center" }}>{file.code}</span>
      <span style={{ minWidth: 0, overflow: "hidden", display: "flex", alignItems: "baseline", flex: 1, whiteSpace: "nowrap" }}>
        <span style={{ flexShrink: 0 }}>{fileName}</span>
        {directoryText && directoryText !== fileName && (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-muted)", marginLeft: 6 }}>{directoryText}</span>
        )}
      </span>
    </button>
  );
}

export function GitGraphTab({ cwd, onOpenFile }: Props) {
  const { t, locale } = useI18n();
  const { isDark } = useTheme();
  const [data, setData] = useState<GitLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[] | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);

  const load = useCallback(async (requestedLimit: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/git/log?${new URLSearchParams({ cwd, limit: String(requestedLimit) }).toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as GitLogResponse);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load(limit);
  }, [load, limit]);

  const layout: GitGraphLayout | null = useMemo(
    () => (data && data.commits.length > 0 ? buildGitGraphLayout(data.commits, "compact") : null),
    [data],
  );

  // Lane colors follow the active theme accent; recompute when it changes.
  const palette = useMemo(() => {
    try {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      return deriveLanePalette(accent);
    } catch {
      return deriveLanePalette("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark]);

  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  const selectedNode = layout?.nodes.find((node) => node.hash === selectedHash) ?? null;
  const selectedCommit = selectedNode ? data?.commits[selectedNode.row] ?? null : null;

  const selectCommit = useCallback(async (hash: string) => {
    setSelectedHash(hash);
    setCommitFiles(null);
    setCommitLoading(true);
    try {
      const response = await fetch(`/api/git/log?${new URLSearchParams({ cwd, commit: hash }).toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCommitFiles((await response.json() as { files?: GitCommitFile[] }).files ?? null);
    } catch {
      setCommitFiles(null);
    } finally {
      setCommitLoading(false);
    }
  }, [cwd]);

  const closeDetail = useCallback(() => {
    setSelectedHash(null);
    setCommitFiles(null);
  }, []);

  const graphWidth = layout ? layout.laneCount * COL_W + GRAPH_PAD * 2 : 0;
  const svgWidth = graphWidth + TEXT_GAP + TEXT_WIDTH;
  const svgHeight = layout ? layout.nodes.length * ROW_H + 12 : 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", textAlign: "left" }}>
          {t("desktop.gitGraphTab")}
        </span>
        <button
          type="button"
          onClick={() => void load(limit)}
          disabled={loading}
          title={t("desktop.refresh")}
          aria-label={t("desktop.refresh")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, padding: 0, border: "none", borderRadius: 5, background: "none", color: "var(--text-dim)", cursor: loading ? "wait" : "pointer", opacity: loading ? 0.55 : 1 }}
        >
          {loading
            ? <Spinner size={12} style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true" />
            : <ArrowClockwise size={13} weight="regular" aria-hidden="true" />}
        </button>
      </div>

      {selectedCommit && (
        <div style={{ flexShrink: 0, maxHeight: "45%", overflowY: "auto", overflowX: "hidden", borderBottom: "1px solid var(--border)", padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: "var(--text)", wordBreak: "break-word" }}>
              {selectedCommit.subject}
              {selectedCommit.refs.length > 0 && (
                <span style={{ color: "var(--accent)", fontWeight: 600, marginLeft: 6 }}>({selectedCommit.refs.join(", ")})</span>
              )}
            </span>
            <button
              type="button"
              onClick={closeDetail}
              title={t("desktop.closeTab")}
              aria-label={t("desktop.closeTab")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, flexShrink: 0, border: "none", borderRadius: 4, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
          <div style={{ marginTop: 2, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
            {selectedCommit.author} · {timeFormat.format(new Date(selectedCommit.timestamp * 1000))} · {selectedCommit.hash.slice(0, 10)}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            {t("desktop.gitGraphCommitFiles")}
          </div>
          <div style={{ marginTop: 2 }}>
            {commitLoading ? (
              <div style={{ padding: "4px 5px", color: "var(--text-dim)", fontSize: 12 }}>
                <Spinner size={12} style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true" />
              </div>
            ) : commitFiles && commitFiles.length > 0 ? (
              commitFiles.map((file) => (
                <CommitFileRow key={`${file.code}:${file.filePath}`} file={file} cwd={cwd} onOpenFile={onOpenFile} />
              ))
            ) : (
              <div style={{ padding: "4px 5px", color: "var(--text-dim)", fontSize: 12 }}>-</div>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {data === null ? null : !data.isGitRepository ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("desktop.gitNotRepository")}
          </div>
        ) : data.commits.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("desktop.gitGraphEmpty")}
          </div>
        ) : layout && (
          <svg width={svgWidth} height={svgHeight} style={{ display: "block", fontFamily: "var(--font-mono)" }} role="img" aria-label={t("desktop.gitGraphTab")}>
            {layout.nodes.map((node) => {
              const isSelected = node.hash === selectedHash;
              return (
                <rect
                  key={`row-${node.hash}`}
                  x={0}
                  y={node.row * ROW_H}
                  width={svgWidth}
                  height={ROW_H}
                  fill={isSelected ? "var(--bg-selected)" : "transparent"}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(event) => { if (!isSelected) event.currentTarget.setAttribute("fill", "var(--bg-hover)"); }}
                  onMouseLeave={(event) => { event.currentTarget.setAttribute("fill", isSelected ? "var(--bg-selected)" : "transparent"); }}
                  onClick={() => void selectCommit(node.hash)}
                />
              );
            })}
            {layout.edges.map((edge, index) => (
              <path
                key={`edge-${index}`}
                d={edgePath(edge)}
                fill="none"
                stroke={palette[edge.colorIndex % palette.length]}
                strokeWidth={2}
                pointerEvents="none"
              />
            ))}
            {layout.nodes.map((node) => (
              <circle
                key={`node-${node.hash}`}
                cx={laneX(node.lane)}
                cy={rowY(node.row)}
                r={NODE_R}
                fill={palette[node.colorIndex % palette.length]}
                stroke="var(--bg)"
                strokeWidth={1.5}
                pointerEvents="none"
              />
            ))}
            {layout.nodes.map((node) => {
              const commit = data.commits[node.row];
              const tx = graphWidth + TEXT_GAP;
              const cy = rowY(node.row);
              return (
                <g key={`label-${node.hash}`} pointerEvents="none">
                  <text x={tx} y={cy + 1} fill="var(--text)" fontSize={12.5} fontWeight={500} fontFamily="system-ui, sans-serif">
                    {commit.subject}
                    {commit.refs.length > 0 && (
                      <tspan fill="var(--accent)" fontWeight={600}> ({commit.refs.join(", ")})</tspan>
                    )}
                  </text>
                  <text x={tx} y={cy + 15} fill="var(--text-muted)" fontSize={10.5}>
                    {commit.author} · {timeFormat.format(new Date(commit.timestamp * 1000))} · {commit.hash.slice(0, 10)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {data?.truncated && (
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            onClick={() => setLimit((current) => Math.min(current + LIMIT_STEP, MAX_LIMIT))}
            disabled={loading}
            style={{ padding: "4px 14px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", cursor: loading ? "wait" : "pointer" }}
          >
            {t("desktop.gitGraphLoadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
