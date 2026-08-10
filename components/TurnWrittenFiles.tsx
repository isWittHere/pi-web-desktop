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
      style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}
    >
      <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 500 }}>
        {t("desktop.filesWritten")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {files.map(({ filePath }) => {
          const name = getFileName(filePath);
          return (
            <button
              key={filePath}
              type="button"
              title={filePath}
              aria-label={t("desktop.openWrittenFile", { name })}
              onClick={() => onOpenFile?.(filePath, { initialDisplayMode: "diff" })}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: "var(--text)",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                transition: "background 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.borderColor = "var(--border-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-subtle)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              {getFileIcon(name, 12)}
              <span>{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
