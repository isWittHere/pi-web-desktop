"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowClockwise, At, Spinner, X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { type GitCommitFile, type GitLogResponse } from "@/lib/git-graph";
import type { GitLogCommit } from "@/lib/git-graph-parser";
import { buildGitGraphLayout, type GitGraphLayout } from "@/lib/git-graph-lanes";
import { gitGraphEdgePath } from "@/lib/git-graph-geometry";
import { deriveLanePalette } from "@/lib/git-graph-palette";
import { parseGitRefTags } from "@/lib/git-graph-refs";
import { RefTagList } from "./GitRefChips";

interface Props {
  /** Repository/worktree directory whose history the tab shows. */
  cwd: string;
  /** Open a file mentioned in a commit's changed-file list (source mode). */
  onOpenFile: (filePath: string, fileName: string) => void;
  /** Insert an @comment: reference to the selected commit into the composer. */
  onMentionCommit?: (commit: GitLogCommit) => void;
}

const DEFAULT_LIMIT = 400;
const LIMIT_STEP = 400;
const MAX_LIMIT = 2000;

// Geometry (px): lane column width, node radii, and elbow corner radius. Rows
// have individual heights — only the newest commit (row 0) carries a second
// info line, so it is taller and its node is drawn as a slightly larger ring
// marking HEAD. The graph and the commit text are separate side-by-side
// columns joined by a draggable divider: the graph column hugs the drawn lanes
// (last lane center + node allowance) and scrolls horizontally on its own when
// dragged narrower than the drawn width.
const ROW_H = 26;
const FIRST_ROW_H = 44;
const COL_W = 18;
const NODE_R = 4;
const HEAD_NODE_R = 6;
const CORNER_R = 7;
const GRAPH_PAD_LEFT = 8;
const GRAPH_PAD_RIGHT = 8;
const TEXT_GAP = 10;
const MIN_TEXT_WIDTH = 140;
const GRAPH_COL_MIN = 28;
const GRAPH_COL_MAX = 480;
// The divider is a 5px hit strip with a 1px line centered inside it.
const DIVIDER_W = 5;
// Best-effort divider-position memory, following the desktop localStorage
// conventions (silently ignored when storage is unavailable).
const GRAPH_COL_WIDTH_KEY = "pi-git-graph-col-width";
// How close to the bottom edge (px) the scroll view must get before the
// floating "load more" button fades in.
const BOTTOM_THRESHOLD = 32;

const rowHeightOf = (row: number) => (row === 0 ? FIRST_ROW_H : ROW_H);

/** Cumulative top offset of each row; rows are not uniformly tall. */
function computeRowTops(rowCount: number): number[] {
  const tops: number[] = [];
  let top = 0;
  for (let row = 0; row < rowCount; row += 1) {
    tops.push(top);
    top += rowHeightOf(row);
  }
  return tops;
}

const laneX = (lane: number) => GRAPH_PAD_LEFT + lane * COL_W + COL_W / 2;

/**
 * Clamp a requested graph-column width. The upper bound is additionally
 * limited by the visible body width so the text column always keeps
 * MIN_TEXT_WIDTH; when the body is not measurable yet (first paint) only the
 * absolute cap applies.
 */
function clampGraphColWidth(value: number, bodyWidth: number): number {
  const absoluteMax = bodyWidth > 0
    ? Math.min(GRAPH_COL_MAX, bodyWidth - MIN_TEXT_WIDTH)
    : GRAPH_COL_MAX;
  return Math.round(Math.min(Math.max(value, GRAPH_COL_MIN), Math.max(absoluteMax, GRAPH_COL_MIN)));
}

function loadStoredGraphColWidth(): number | null {
  try {
    const parsed = Number(window.localStorage.getItem(GRAPH_COL_WIDTH_KEY));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function storeGraphColWidth(value: number): void {
  try {
    window.localStorage.setItem(GRAPH_COL_WIDTH_KEY, String(value));
  } catch {
    // Storage unavailable (private mode, quota) — the divider just won't persist.
  }
}

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

export function GitGraphTab({ cwd, onOpenFile, onMentionCommit }: Props) {
  const { t, locale } = useI18n();
  const { isDark } = useTheme();
  const [data, setData] = useState<GitLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[] | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  // null = "hug the drawn lanes"; a number means the user picked a width.
  const [graphColWidth, setGraphColWidth] = useState<number | null>(loadStoredGraphColWidth);
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);

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

  // The derived palette is published as CSS custom properties on the tab root,
  // so every visible color (edges, nodes, ref chips) resolves from a var() and
  // stays overridable from the theme layer.
  const laneVars = useMemo(() => {
    const vars: Record<string, string> = {};
    palette.forEach((color, index) => {
      vars[`--git-graph-lane-${index}`] = color;
    });
    // CSS custom properties are valid style keys but not in React's CSSProperties index.
    return vars as CSSProperties;
  }, [palette]);
  const laneVar = (colorIndex: number) => `var(--git-graph-lane-${colorIndex % palette.length})`;

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

  // The "load more" button lives inside the scroll view as a sticky footer and
  // only appears once the list is scrolled to (near) its bottom, so it does
  // not permanently occupy space under the graph.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atListBottom, setAtListBottom] = useState(false);
  const updateAtListBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtListBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD);
  }, []);

  useEffect(() => {
    updateAtListBottom();
  }, [data, layout, updateAtListBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateAtListBottom());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateAtListBottom]);

  const graphWidth = layout
    ? GRAPH_PAD_LEFT + Math.max(layout.laneCount - 1, 0) * COL_W + COL_W / 2 + GRAPH_PAD_RIGHT
    : 0;
  // While the user has not picked a width, the graph column hugs the drawn
  // lanes so sparse histories never waste text space.
  const graphColW = clampGraphColWidth(graphColWidth ?? graphWidth, scrollRef.current?.clientWidth ?? 0);
  const rowTops = useMemo(() => computeRowTops(data?.commits.length ?? 0), [data]);
  const svgHeight = rowTops.length > 0 ? rowTops[rowTops.length - 1] + rowHeightOf(rowTops.length - 1) + 8 : 0;

  const applyGraphColWidth = useCallback((value: number) => {
    const next = clampGraphColWidth(value, scrollRef.current?.clientWidth ?? 0);
    setGraphColWidth(next);
    storeGraphColWidth(next);
  }, []);

  // Pointer-capture drag: move/up keep firing on the divider even when the
  // cursor leaves it, so no window-level listeners are needed.
  const dividerDragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const startDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dividerDragRef.current = { startX: event.clientX, startWidth: graphColW, width: graphColW };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  };

  const moveDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag) return;
    drag.width = clampGraphColWidth(drag.startWidth + event.clientX - drag.startX, scrollRef.current?.clientWidth ?? 0);
    setGraphColWidth(drag.width);
  };

  const endDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag) return;
    dividerDragRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    storeGraphColWidth(drag.width);
  };

  // Both columns render one hit-row per commit; sharing the hover state keeps
  // the highlight continuous across the divider. Hover is only cleared when
  // the pointer leaves the whole body, so crossing the 5px divider does not
  // blink the band off.
  const rowBackground = (hash: string) =>
    hash === selectedHash ? "var(--bg-selected)" : hash === hoveredHash ? "var(--bg-hover)" : "transparent";
  const rowHitProps = (hash: string) => ({
    onClick: () => void selectCommit(hash),
    onMouseEnter: () => setHoveredHash(hash),
  });

  return (
    <div style={{ ...laneVars, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", userSelect: isResizing ? "none" : undefined }}>
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

      <div
        ref={scrollRef}
        onScroll={updateAtListBottom}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
      >
        {data === null ? null : !data.isGitRepository ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("desktop.gitNotRepository")}
          </div>
        ) : data.commits.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("desktop.gitGraphEmpty")}
          </div>
        ) : layout && (
          <div
            style={{ position: "relative", display: "flex", alignItems: "stretch", height: svgHeight }}
            onMouseLeave={() => setHoveredHash(null)}
          >
            {/* Row highlight layer spans the full body width behind both
                columns and the divider, so hover/selection reads as one
                continuous band instead of breaking at the divider. The
                columns and the divider stay transparent above it. */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {layout.nodes.map((node) => (
                <div
                  key={`hl-${node.hash}`}
                  style={{ position: "absolute", left: 0, right: 0, top: rowTops[node.row], height: rowHeightOf(node.row), background: rowBackground(node.hash) }}
                />
              ))}
            </div>
            {/* Graph column: it owns the horizontal scrolling, so dragging it
                narrower than the drawn lanes scrolls instead of truncating.
                The SVG sits above the row hit-areas but ignores pointer
                events, so the highlight band stays behind the lines. */}
            <div style={{ width: graphColW, flexShrink: 0, overflowX: "auto", overflowY: "hidden" }}>
              <div
                style={{ position: "relative", width: "100%", minWidth: graphWidth, height: svgHeight }}
                role="img"
                aria-label={t("desktop.gitGraphTab")}
              >
                <svg
                  width={graphWidth}
                  height={svgHeight}
                  style={{ position: "absolute", top: 0, left: 0, zIndex: 1, pointerEvents: "none", display: "block" }}
                  aria-hidden="true"
                >
                  {layout.edges.map((edge, index) => (
                    <path
                      key={`edge-${index}`}
                      d={gitGraphEdgePath(edge, { laneX, rowTops, rowHeight: rowHeightOf, cornerRadius: CORNER_R })}
                      fill="none"
                      stroke={laneVar(edge.colorIndex)}
                      strokeWidth={1.5}
                    />
                  ))}
                  {layout.nodes.map((node) => {
                    const isHeadRow = node.row === 0;
                    return (
                      <circle
                        key={`node-${node.hash}`}
                        cx={laneX(node.lane)}
                        cy={rowTops[node.row] + rowHeightOf(node.row) / 2}
                        r={isHeadRow ? HEAD_NODE_R : NODE_R}
                        fill={isHeadRow ? "var(--bg)" : laneVar(node.colorIndex)}
                        stroke={isHeadRow ? laneVar(node.colorIndex) : "var(--bg)"}
                        strokeWidth={isHeadRow ? 2 : 1.5}
                      />
                    );
                  })}
                </svg>
                {layout.nodes.map((node) => (
                  <div
                    key={`hit-${node.hash}`}
                    {...rowHitProps(node.hash)}
                    title={data.commits[node.row].subject}
                    style={{ position: "absolute", left: 0, right: 0, top: rowTops[node.row], height: rowHeightOf(node.row), cursor: "pointer" }}
                  />
                ))}
              </div>
            </div>

            {/* Draggable divider between graph and text columns. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("desktop.gitGraphResizeGraph")}
              aria-valuemin={GRAPH_COL_MIN}
              aria-valuemax={GRAPH_COL_MAX}
              aria-valuenow={graphColW}
              tabIndex={0}
              onPointerDown={startDividerDrag}
              onPointerMove={moveDividerDrag}
              onPointerUp={endDividerDrag}
              onPointerCancel={endDividerDrag}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                applyGraphColWidth(graphColW + (event.key === "ArrowLeft" ? -COL_W : COL_W));
              }}
              style={{ flexShrink: 0, width: DIVIDER_W, display: "flex", justifyContent: "center", cursor: "col-resize", touchAction: "none" }}
            >
              <div style={{ width: 1, height: "100%", background: "color-mix(in srgb, var(--border) 55%, transparent)" }} />
            </div>

            {/* Text column: takes whatever width the divider leaves. */}
            <div style={{ flex: 1, minWidth: 0, position: "relative", height: svgHeight, overflow: "hidden" }}>
              {layout.nodes.map((node) => {
                const commit = data.commits[node.row];
                const isHeadRow = node.row === 0;
                return (
                  <div
                    key={`row-${node.hash}`}
                    {...rowHitProps(node.hash)}
                    title={commit.subject}
                    style={{ position: "absolute", left: 0, right: 0, top: rowTops[node.row], height: rowHeightOf(node.row), display: "flex", alignItems: "center", cursor: "pointer" }}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingLeft: TEXT_GAP, paddingRight: 10, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                        <RefTagList tags={parseGitRefTags(commit.refs)} laneColor={laneVar(node.colorIndex)} />
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 500, color: "var(--text)" }}>
                          {commit.subject}
                        </span>
                      </div>
                      {isHeadRow && (
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-muted)" }}>
                          {commit.author} · {timeFormat.format(new Date(commit.timestamp * 1000))} · {commit.hash.slice(0, 10)}
                        </div>
                      )}
                    </div>
                    {onMentionCommit && hoveredHash === node.hash && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMentionCommit(commit);
                        }}
                        title={t("desktop.mentionInChat")}
                        aria-label={t("desktop.mentionInChat")}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--accent)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-panel)"; e.currentTarget.style.color = "var(--text-dim)"; }}
                        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)", color: "var(--text-dim)", cursor: "pointer", zIndex: 1 }}
                      >
                        <At size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data?.isGitRepository && data.truncated && (
          <div
            style={{
              position: "sticky",
              bottom: 0,
              zIndex: 2,
              display: "flex",
              justifyContent: "center",
              padding: "6px 0 8px",
              // Opaque backing so pinned graph rows/text don't show through.
              background: "var(--bg)",
              pointerEvents: atListBottom ? "auto" : "none",
              opacity: atListBottom ? 1 : 0,
              visibility: atListBottom ? "visible" : "hidden",
              transition: "opacity 0.15s ease, visibility 0.15s ease",
            }}
          >
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

      {selectedCommit && (
        <div style={{ flexShrink: 0, maxHeight: "45%", overflowY: "auto", overflowX: "hidden", borderTop: "1px solid var(--border)", padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: "var(--text)", wordBreak: "break-word" }}>
              {selectedCommit.subject}
              {selectedCommit.refs.length > 0 && selectedNode && (
                <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginLeft: 6, verticalAlign: "middle" }}>
                  <RefTagList tags={parseGitRefTags(selectedCommit.refs)} laneColor={laneVar(selectedNode.colorIndex)} />
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onMentionCommit?.(selectedCommit)}
              title={t("desktop.mentionInChat")}
              aria-label={t("desktop.mentionInChat")}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, flexShrink: 0, border: "none", borderRadius: 4, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
            >
              <At size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={closeDetail}
              title={t("desktop.closeTab")}
              aria-label={t("desktop.closeTab")}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
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
    </div>
  );
}
