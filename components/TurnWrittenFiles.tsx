"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";

/**
 * Lists the files a turn actually wrote, as buttons that open each one in the
 * preview pane (diff view when the repository can provide one). Entries come
 * from the turn's successful `write`/`edit` tool calls — the reply text is
 * never scanned for paths.
 */
export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string, options?: { initialDisplayMode?: "diff" }) => void;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;

  return (
    <div
      aria-label={t("desktop.filesWritten")}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: "calc(var(--spacing) * 3)" }}
    >
      {files.map((file) => {
          const name = getFileName(file.filePath);
          return (
            <button
              key={file.filePath}
              type="button"
              title={file.filePath}
              aria-label={t("desktop.openWrittenFile", { name })}
              onClick={() => onOpenFile?.(file.filePath, { initialDisplayMode: "diff" })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "color-mix(in srgb, var(--text-dim) 6%, var(--bg-subtle))";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-subtle)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              {getFileIcon(name, 12)}
              <span>{name}</span>
              {file.additions !== undefined && file.additions > 0 && (
                <span style={{ color: "var(--accent-green)", fontWeight: 500 }}>+{file.additions}</span>
              )}
              {file.deletions !== undefined && file.deletions > 0 && (
                <span style={{ color: "var(--accent-red)", fontWeight: 500 }}>-{file.deletions}</span>
              )}
            </button>
          );
        })}
    </div>
  );
}
