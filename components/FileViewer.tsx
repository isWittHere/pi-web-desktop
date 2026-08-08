"use client";

import { useEffect, useState, useRef, useCallback, useContext, useMemo, type MouseEvent } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import ReactMarkdown from "react-markdown";
import { useI18n } from "@/hooks/useI18n";
import {
  DOCX_PREVIEW_MAX_BYTES,
  getFileExt,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
  isVideoPath,
} from "@/lib/file-types";
import { encodeFilePathForApi, getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { resolveLocalFileHref } from "@/lib/file-links";
import { headingId, markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { prismTheme } from "@/lib/prism-theme";
import { CodeBlock, MarkdownCodeContext, MermaidBlock } from "@/components/MarkdownBody";
import { parseUnifiedPatch } from "@/lib/patch";
import type { GitFileDiffResponse } from "@/lib/git-types";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
  initialDisplayMode?: "diff";
}

interface FileData {
  content: string;
  language: string;
  size: number;
}

function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const encoded = encodeFilePathForApi(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `/api/files/${encoded}?${searchParams.toString()}`;
}

function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();

  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("desktop.downloadFile")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 20,
        padding: "0 5px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        color: "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
        textDecoration: "none",
      }}
    >
      <DownloadSimple size={11} aria-hidden="true" />
    </a>
  );
}

type DiffLine =
  | { type: "unchanged"; text: string }
  | { type: "removed"; text: string }
  | { type: "added"; text: string };

type DiffBlockKind = "delete" | "add" | "edit";

// Diff colors come from the active pi CLI theme palette via the git-status
// CSS variables — the same set used by the quick-changes indicator — so they
// stay in sync with the theme JSON's diff/semantic colors.
// The left indicator bar expresses the change-block type: pure deletions are
// red, pure additions green, edits (removed + added) yellow.
const DIFF_BLOCK_BORDER: Record<DiffBlockKind, string> = {
  delete: "3px solid var(--git-status-deleted)",
  add: "3px solid var(--git-status-added)",
  edit: "3px solid var(--git-status-modified)",
};
// Row backgrounds stay red for removed lines and green for added lines; the
// yellow is reserved for the indicator bar above.
const DIFF_REMOVED_BG = "var(--git-status-deleted-bg)";
const DIFF_ADDED_BG = "var(--git-status-added-bg)";
// Added lines show their new-file line number in green, replacing the +/-
// prefix; deleted lines show no line number at all.
const DIFF_ADD_NUMBER_COLOR = "var(--git-status-added)";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Myers diff — returns line-level unified diff
function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;
  const max = m + n;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
        x = v[k + 1 + max];
      } else {
        x = v[k - 1 + max] + 1;
      }
      let y = x - k;
      while (x < m && y < n && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= m && y >= n) {
        // backtrack
        const result: DiffLine[] = [];
        let cx = m, cy = n;
        for (let dd = d; dd > 0; dd--) {
          const pv = trace[dd - 1];
          const pk = cx - cy;
          let prevK: number;
          if (pk === -dd || (pk !== dd && pv[pk - 1 + max] < pv[pk + 1 + max])) {
            prevK = pk + 1;
          } else {
            prevK = pk - 1;
          }
          const prevX = pv[prevK + max];
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) {
            cx--;
            cy--;
            result.unshift({ type: "unchanged", text: oldLines[cx] });
          }
          if (dd > 0) {
            if (cx > prevX) {
              cx--;
              result.unshift({ type: "removed", text: oldLines[cx] });
            } else {
              cy--;
              result.unshift({ type: "added", text: newLines[cy] });
            }
          }
        }
        while (cx > 0 && cy > 0) {
          cx--;
          cy--;
          result.unshift({ type: "unchanged", text: oldLines[cx] });
        }
        return result;
      }
    }
  }
  // Fallback: treat all as replaced
  return [
    ...oldLines.map((t) => ({ type: "removed" as const, text: t })),
    ...newLines.map((t) => ({ type: "added" as const, text: t })),
  ];
}

function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const { t } = useI18n();
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diff = diffLines(oldLines, newLines);

  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        {t("desktop.noChanges")}
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (l.type !== "unchanged" ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (visible.has(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && visible.has(i)) {
        block.push(diff[i]);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (i < diff.length && !visible.has(i)) {
        count++;
        i++;
      }
      segments.push({ hidden: true, count });
    }
  }

  // Track running line number for added/unchanged lines
  const newLineNos: number[] = [];
  let nlo = 1;
  for (const line of diff) {
    if (line.type === "removed") {
      newLineNos.push(0);
    } else {
      newLineNos.push(nlo++);
    }
  }

  let diffIdx = 0;

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6, minWidth: "max-content" }}>
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              style={{
                padding: "2px 16px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                fontSize: 11,
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {t("desktop.unchangedLines", { count: seg.count })}
            </div>
          );
          diffIdx += seg.count;
          return result;
        }
        // Group consecutive changed lines into delete / add / edit blocks;
        // context lines break the block. Edited blocks render all removed
        // lines first, then all added lines.
        const out: Array<{
          key: string;
          kind: "context" | "removed" | "added";
          text: string;
          lineNo: number | null;
          block: DiffBlockKind | null;
        }> = [];
        let removed: Array<{ key: string; text: string }> = [];
        let added: Array<{ key: string; text: string; lineNo: number | null }> = [];
        const flushBlock = () => {
          if (removed.length || added.length) {
            const block: DiffBlockKind = removed.length && added.length ? "edit" : removed.length ? "delete" : "add";
            for (const r of removed) out.push({ key: r.key, kind: "removed", text: r.text, lineNo: null, block });
            for (const a of added) out.push({ key: a.key, kind: "added", text: a.text, lineNo: a.lineNo, block });
            removed = [];
            added = [];
          }
        };
        seg.lines.forEach((line, li) => {
          if (line.type === "unchanged") {
            flushBlock();
            out.push({ key: `${si}:${li}`, kind: "context", text: line.text, lineNo: newLineNos[diffIdx + li], block: null });
          } else if (line.type === "removed") {
            removed.push({ key: `${si}:${li}`, text: line.text });
          } else {
            added.push({ key: `${si}:${li}`, text: line.text, lineNo: newLineNos[diffIdx + li] });
          }
        });
        flushBlock();

        const rendered = out.map((row) => {
          const bg = row.kind === "removed" ? DIFF_REMOVED_BG : row.kind === "added" ? DIFF_ADDED_BG : "transparent";
          const borderLeft = row.block ? DIFF_BLOCK_BORDER[row.block] : "3px solid transparent";
          const numberColor = row.kind === "added" ? DIFF_ADD_NUMBER_COLOR : "var(--text-dim)";
          return (
            <div
              key={row.key}
              style={{
                display: "flex",
                background: bg,
                borderLeft,
              }}
            >
              <span
                style={{
                  minWidth: 44,
                  padding: "0 8px 0 16px",
                  textAlign: "right",
                  color: numberColor,
                  userSelect: "none",
                  fontSize: 11,
                  lineHeight: 1.6,
                  flexShrink: 0,
                }}
              >
                {row.lineNo ?? ""}
              </span>
              <span style={{ flex: 1, minWidth: 0, padding: "0 8px 0 0", whiteSpace: "pre", color: "var(--text)" }}>
                {row.text || "\u00a0"}
              </span>
            </div>
          );
        });
        diffIdx += seg.lines.length;
        return <div key={si}>{rendered}</div>;
      })}
    </div>
  );
}

function GitDiffView({ patch }: { patch: string }) {
  const files = parseUnifiedPatch(patch);
  if (!files) return null;

  // Flatten the split (side-by-side) representation into unified rows like
  // `git diff`. Consecutive changed lines form one block, classified as
  // delete / add / edit:
  //   delete: only removed lines  -> red
  //   add:    only added lines    -> green
  //   edit:   removed + added     -> yellow, with all removed lines rendered
  //                                  first, then all added lines
  // Deleted lines show no line number; added lines show their new-file line
  // number in green, replacing the +/- prefix.
  type Row = {
    key: string;
    kind: "hunk" | "context" | "removed" | "added";
    text: string;
    lineNo: number | null;
    block: DiffBlockKind | null;
  };
  const rows: Row[] = [];
  let removed: Array<{ key: string; text: string }> = [];
  let added: Array<{ key: string; text: string; lineNo: number | null }> = [];
  const flushBlock = () => {
    if (removed.length || added.length) {
      const block: DiffBlockKind = removed.length && added.length ? "edit" : removed.length ? "delete" : "add";
      for (const r of removed) rows.push({ key: r.key, kind: "removed", text: r.text, lineNo: null, block });
      for (const a of added) rows.push({ key: a.key, kind: "added", text: a.text, lineNo: a.lineNo, block });
      removed = [];
      added = [];
    }
  };
  files.forEach((file, fileIndex) => {
    file.rows.forEach((row, rowIndex) => {
      if (row.type === "hunk") {
        flushBlock();
        rows.push({ key: `${fileIndex}:${rowIndex}:h`, kind: "hunk", text: row.text, lineNo: null, block: null });
        return;
      }
      const { left, right } = row;
      if (left.type === "context" && right.type === "context") {
        flushBlock();
        rows.push({ key: `${fileIndex}:${rowIndex}:c`, kind: "context", text: left.text, lineNo: right.lineNo, block: null });
        return;
      }
      if (left.type === "removed") {
        removed.push({ key: `${fileIndex}:${rowIndex}:l`, text: left.text });
      }
      if (right.type === "added") {
        added.push({ key: `${fileIndex}:${rowIndex}:r`, text: right.text, lineNo: right.lineNo });
      }
    });
  });
  flushBlock();

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55, minWidth: "max-content" }}>
      {rows.map((row) => {
        if (row.kind === "hunk") {
          return (
            <div key={row.key}>
              {/* Leave one blank line above and below each hunk header so the
                  abbreviated summary reads as a gap between the surrounding
                  diff rows. */}
              <div style={{ height: "1.55em" }} />
              <div style={{ padding: "3px 12px", color: "var(--accent-blue)", background: "var(--bg-secondary)" }}>
                {row.text}
              </div>
              <div style={{ height: "1.55em" }} />
            </div>
          );
        }
        const bg = row.kind === "removed" ? DIFF_REMOVED_BG : row.kind === "added" ? DIFF_ADDED_BG : "transparent";
        const borderLeft = row.block ? DIFF_BLOCK_BORDER[row.block] : "3px solid transparent";
        const numberColor = row.kind === "added" ? DIFF_ADD_NUMBER_COLOR : "var(--text-dim)";
        return (
          <div
            key={row.key}
            style={{
              display: "flex",
              background: bg,
              borderLeft,
            }}
          >
            <span
              style={{
                width: 44,
                flexShrink: 0,
                padding: "0 8px 0 16px",
                textAlign: "right",
                color: numberColor,
                userSelect: "none",
                fontSize: 11,
              }}
            >
              {row.lineNo ?? ""}
            </span>
            <span style={{ flex: 1, minWidth: 0, padding: "0 8px 0 0", whiteSpace: "pre", color: "var(--text)" }}>
              {row.text || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ImageViewer({ filePath, cwd, sourceSessionId }: Props) {
  const { t } = useI18n();
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setBust((b) => b + 1);
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, sourceSessionId]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  const formatSizeStr = size != null ? formatSize(size) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || t("desktop.image")}</span>
        {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundImage:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError(t("desktop.failedToLoadImage"))}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function MediaViewer({ filePath, cwd, sourceSessionId, kind }: Props & { kind: "audio" | "video" }) {
  const { t } = useI18n();
  const isVideo = kind === "video";
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, sourceSessionId]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || (isVideo ? t("desktop.video") : t("desktop.audio"))}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ width: isVideo ? "min(960px, 100%)" : "min(680px, 100%)", maxHeight: "100%" }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {error}
            </div>
          )}
          {isVideo ? <video
            key={src}
            controls
            playsInline
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError(t("desktop.failedToLoadVideo"))}
            style={{ width: "100%", maxHeight: "calc(100vh - 110px)", objectFit: "contain", background: "#000", borderRadius: 6 }}
          /> : <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError(t("desktop.failedToLoadAudio"))}
            style={{ width: "100%" }}
          />}
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId }: Props) {
  const { t } = useI18n();
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const previewUrl = isPdf
    ? getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((r) => r.json())
      .then((d: { size?: number; error?: string }) => {
        if (d.error) setError(d.error);
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError(t("desktop.docxTooLargeForPreview"));
          }
        }
      })
      .catch((e) => setError(String(e)));

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError(t("desktop.docxTooLargeForPreview"));
            return;
          }
        }
      } catch { /* ignore */ }
      setError(null);
      setBust((b) => b + 1);
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, isPdf, sourceSessionId, t]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext === "docx" ? t("desktop.docxPreview") : "pdf"}</span>
        {size != null && <span>{formatSize(size)}</span>}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg-panel)" }}>
        {error ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#f87171", fontSize: 13, textAlign: "center" }}>
            {error}
          </div>
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : "allow-same-origin"}
            title={t("desktop.previewFile", { file: getFileName(filePath) })}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--bg)" : "#eef1f5" }}
          />
        )}
      </div>
    </div>
  );
}

export function FileViewer({ filePath, cwd, sourceSessionId, onOpenFile, initialDisplayMode }: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isAudioPath(filePath)) {
    return <MediaViewer kind="audio" filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isVideoPath(filePath)) {
    return <MediaViewer kind="video" filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  return <TextFileViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} onOpenFile={onOpenFile} initialDisplayMode={initialDisplayMode} />;
}

function TextFileViewer({ filePath, cwd, sourceSessionId, onOpenFile, initialDisplayMode }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");
  const [wrapLines, setWrapLines] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  const fetchGitDiff = useCallback(async (targetPath: string) => {
    if (!cwd) {
      setGitDiff(null);
      return;
    }
    try {
      const params = new URLSearchParams({ cwd, path: targetPath });
      const response = await fetch(`/api/git/diff?${params.toString()}`);
      const result = await response.json() as GitFileDiffResponse;
      setGitDiff(response.ok && result.supported && typeof result.patch === "string" ? result : null);
    } catch {
      setGitDiff(null);
    }
  }, [cwd]);

  const fetchContent = useCallback((filePath: string, isRefresh = false) => {
    return fetch(getFileApiUrl(filePath, "read", sourceSessionId))
      .then((r) => r.json())
      .then((d: FileData & { error?: string }) => {
        if (d.error) {
          setError(d.error);
          return null;
        }
        if (isRefresh) {
          setData((prev) => {
            if (prev) setPrevContent(prev.content);
            return d;
          });
          setChangeCount((c) => c + 1);
        } else {
          setData(d);
        }
        return d;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      });
  }, [sourceSessionId]);

  // Initial load + SSE watch setup
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setPrevContent(null);
    setGitDiff(null);
    setPreviewMode(false);
    setViewMode("source");
    setWrapLines(false);
    setChangeCount(0);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetchContent(filePath).then((d) => {
      if (d?.language === "markdown" && initialDisplayMode !== "diff") setPreviewMode(true);
    }).finally(() => setLoading(false));
    void fetchGitDiff(filePath);

    // Set up SSE watch
    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("change", () => {
      fetchContent(filePath, true);
      void fetchGitDiff(filePath);
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, fetchContent, fetchGitDiff, initialDisplayMode, sourceSessionId]);

  const normalizedMarkdown = useMemo(
    () => normalizeDisplayMath(data?.content ?? ""),
    [data?.content],
  );
  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";

  useEffect(() => {
    if (initialDisplayMode === "diff" && hasGitDiff) setViewMode("diff");
  }, [hasGitDiff, initialDisplayMode]);

  const isDeletedGitDiff = hasGitDiff && gitDiff?.status === "deleted";

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        {t("desktop.loadingFile")}
      </div>
    );
  }

  if (isDeletedGitDiff && !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <div style={{ padding: "5px 16px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </div>
        <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}><GitDiffView patch={gitDiff.patch!} /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";
  const markdownDirectory = getFileDirectory(filePath);
  const lines = data.content.split("\n");
  const hasLiveDiff = prevContent !== null && prevContent !== data.content;
  const hasDiff = hasLiveDiff || hasGitDiff;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{data.language}</span>
        {viewMode === "source" && <span>{t("desktop.lines", { count: lines.length })}</span>}
        <span>{formatSize(data.size)}</span>

        {/* Diff / Source toggle — shown only when there are changes */}
        {hasDiff && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setViewMode("source")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: viewMode === "source" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "source" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "source" ? 600 : 400,
              }}
            >
              {t("desktop.source")}
            </button>
            <button
              onClick={() => setViewMode("diff")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: viewMode === "diff" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "diff" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "diff" ? 600 : 400,
              }}
            >
              {t("desktop.diff")} {changeCount > 0 && <span style={{ color: "var(--git-status-added)", marginLeft: 2 }}>+{changeCount}</span>}
            </button>
          </div>
        )}

        {/* Word wrap toggle */}
        {viewMode === "source" && !previewMode && (
          <button
            onClick={() => setWrapLines((v) => !v)}
            title={wrapLines ? t("desktop.disableWordWrap") : t("desktop.enableWordWrap")}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: wrapLines ? "var(--bg-selected)" : "var(--bg-hover)",
              color: wrapLines ? "var(--text)" : "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: wrapLines ? 600 : 400,
            }}
          >
            {t("desktop.wrap")}
          </button>
        )}

        {/* HTML source/preview toggle */}
        {isHtml && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              {t("desktop.code")}
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              {t("desktop.preview")}
            </button>
          </div>
        )}

        {/* Markdown preview/raw toggle */}
        {isMarkdown && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              {t("desktop.preview")}
            </button>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              {t("desktop.raw")}
            </button>
          </div>
        )}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
        {viewMode === "diff" && hasDiff ? (
          hasGitDiff
            ? <GitDiffView patch={gitDiff.patch!} />
            : <DiffView oldContent={prevContent!} newContent={data.content} />
        ) : isHtml && previewMode ? (
          <iframe
            srcDoc={data.content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
            title={t("desktop.htmlPreview")}
          />
        ) : isMarkdown && previewMode ? (
          <div
            className="markdown-body markdown-file-preview"
            style={{ padding: "24px 32px" }}
          >
            <ReactMarkdown
              remarkPlugins={markdownRemarkPlugins}
              rehypePlugins={markdownRehypePlugins}
              components={{
                h1({ children }: React.ComponentProps<'h1'>) {
                  return <h1 id={headingId(children)}>{children}</h1>
                },
                h2({ children }: React.ComponentProps<'h2'>) {
                  return <h2 id={headingId(children)}>{children}</h2>
                },
                h3({ children }: React.ComponentProps<'h3'>) {
                  return <h3 id={headingId(children)}>{children}</h3>
                },
                code: function CodeElement({ className, children, ...props }) {
                  // `node` is react-markdown metadata, never a DOM attribute.
                  delete props.node;
                  const lang = className?.replace("language-", "").toLowerCase() ?? "";
                  const raw = String(children);
                  const isBlock = useContext(MarkdownCodeContext);
                  if (isBlock) {
                    if (lang === "mermaid") {
                      return <MermaidBlock code={raw.replace(/\n$/, "")} />;
                    }
                    return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
                  }
                  return (
                    <code
                      className="inline max-w-full whitespace-normal break-words [overflow-wrap:anywhere] align-baseline bg-(--bg-secondary) border border-(--border) px-1.5 py-0.5 text-xs font-mono text-(--accent-blue)"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre: function PreElement({ children }) {
                  // Mark real code blocks: `code` reads this context to decide
                  // block vs inline (newlines in inline code spans are legal).
                  return <MarkdownCodeContext.Provider value>{children}</MarkdownCodeContext.Provider>;
                },
                a({ href, children, ...props }) {
                  delete props.node;
                  const linkClass = "text-(--accent-blue) underline underline-offset-2 hover:text-(--accent-blue)/80";
                  const linkedFile = onOpenFile
                    ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
                    : null;
                  if (!linkedFile || !onOpenFile) {
                    return (
                      <a href={href} {...props} className={linkClass} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    );
                  }

                  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (event.defaultPrevented || event.button !== 0) return;
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    const target = event.currentTarget.getAttribute("target");
                    if (target && target !== "_self") return;
                    event.preventDefault();
                    onOpenFile(linkedFile);
                  };

                  return (
                    <a href={href} {...props} className={linkClass} onClick={handleClick}>
                      {children}
                    </a>
                  );
                },
                table({ children }) {
                  return (
                    <div className="my-3 rounded-lg overflow-hidden border border-(--border)">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse [&_tr:last-child>td]:border-b-0">
                          {children}
                        </table>
                      </div>
                    </div>
                  );
                },
              }}
            >
              {normalizedMarkdown}
            </ReactMarkdown>
          </div>
        ) : (
          <SyntaxHighlighter
            language={data.language === "text" ? "plaintext" : data.language}
            style={prismTheme}
            showLineNumbers
            lineNumberStyle={{
              color: "var(--text-dim)",
              fontStyle: "normal",
              minWidth: "3em",
              paddingRight: "1em",
            }}
            customStyle={{
              margin: 0,
              padding: "12px 0",
              background: "var(--bg)",
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: "var(--font-mono)",
              minHeight: "100%",
            }}
            codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
            wrapLongLines={wrapLines}
          >
            {data.content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
