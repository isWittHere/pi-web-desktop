"use client";

import { useState, type ReactNode } from "react";
import { GitDiff, GitMerge } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  /** Repository/worktree directory new view tabs would target; null disables them. */
  cwd: string | null;
  onOpenViewTab: (kind: "changes" | "git-graph", cwd: string) => void;
}

interface Action {
  key: "changes" | "git-graph";
  label: string;
  icon: ReactNode;
}

export function RightPanelEmptyState({ cwd, onOpenViewTab }: Props) {
  const { t } = useI18n();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const actions: Action[] = [
    { key: "changes", label: t("desktop.changesTab"), icon: <GitDiff size={17} weight="regular" aria-hidden="true" /> },
    // Git graph flips the git-merge glyph vertically to read as branches
    // fanning downward, matching the graph's top-to-bottom history flow.
    { key: "git-graph", label: t("desktop.gitGraphTab"), icon: <GitMerge size={17} weight="regular" aria-hidden="true" style={{ transform: "scaleY(-1)" }} /> },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", textAlign: "center" }}>
        {t("desktop.rightPanelEmptyTitle")}
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
        {t("desktop.rightPanelEmptySubtitle")}
      </div>
      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 300 }}>
        {actions.map((action) => {
          const hovered = hoveredKey === action.key;
          return (
            <button
              key={action.key}
              type="button"
              disabled={!cwd}
              title={cwd ? undefined : t("desktop.rightPanelEmptyNeedsProject")}
              onClick={() => cwd && onOpenViewTab(action.key, cwd)}
              onMouseEnter={() => setHoveredKey(action.key)}
              onMouseLeave={() => setHoveredKey(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "13px 16px",
                border: "none",
                borderRadius: 10,
                background: hovered && cwd ? "var(--bg-card-hover)" : "var(--bg-card)",
                color: "var(--text)",
                cursor: cwd ? "pointer" : "default",
                opacity: cwd ? 1 : 0.55,
                textAlign: "left",
                transition: "background 0.1s",
              }}
            >
              <span style={{ color: "var(--text-muted)", flexShrink: 0, display: "flex", alignItems: "center" }}>
                {action.icon}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{action.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 18, fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
        {t("desktop.rightPanelEmptyHint")}
      </div>
    </div>
  );
}
