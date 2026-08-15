"use client";

import { useRef, useState } from "react";
import { CaretRight, Check, Plus, Trash } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import type { WorktreeEntry, WorktreeState } from "./SessionSidebar";

/**
 * "Worktrees" sidebar panel (tabs view mode). The worktree switcher moves
 * here from the title bar / welcome page: the current branch, the full
 * worktree list (create / remove / dirty-force-confirm) and the guidance
 * row for non-git directories. Data logic stays in SessionSidebar (it owns
 * the worktree polling); this panel is a pure view over it.
 *
 * The panel exists for any git top-level: the current branch, the full
 * worktree list (create / remove / dirty-force-confirm) and the guidance
 * row for non-git directories. Data logic stays in SessionSidebar (it owns
 * the worktree polling); this panel is a pure view over it.
 *
 * A repo with only the main checkout still shows the panel (current branch
 * + the "new worktree" entry) — the tabs view mode hides every other
 * worktree entry point, so without it the first worktree could never be
 * created. It starts collapsed so the session list stays the primary
 * surface.
 */

interface WorktreePanelProps {
  worktreeState: WorktreeState | null;
  selectedCwd: string | null;
  homeDir: string;
  onSelect: (path: string) => void;
  /** Resolves true when the worktree was created (panel keeps its input
   *  open on failure so the error stays visible). */
  onCreate: (branch: string) => Promise<boolean>;
  onRemove: (path: string, force: boolean) => Promise<void>;
  busy: boolean;
  error: string | null;
  confirmRemove: string | null;
  onConfirmRemoveChange: (path: string | null) => void;
}

/** Substitute the home dir prefix with ~ */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/** A worktree row: branch label + current marker + main tag + remove. */
function WorktreeRow({
  wt,
  isCurrent,
  showRemove,
  busy,
  confirming,
  homeDir,
  onSelect,
  onRemove,
  onConfirmChange,
}: {
  wt: WorktreeEntry;
  isCurrent: boolean;
  showRemove: boolean;
  busy: boolean;
  confirming: boolean;
  homeDir: string;
  onSelect: () => void;
  onRemove: (force: boolean) => void;
  onConfirmChange: (confirming: boolean) => void;
}) {
  const { t } = useI18n();
  const label = wt.branch ?? displayCwd(wt.path, homeDir);

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "rgba(239,68,68,0.06)", borderRadius: 5 }}>
        <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("desktop.uncommittedChanges")}
        </span>
        <button
          onClick={() => onRemove(true)}
          disabled={busy}
          style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
        >
          {t("desktop.force")}
        </button>
        <button
          onClick={() => onConfirmChange(false)}
          style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
        >
          {t("desktop.cancel")}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <button
        onClick={onSelect}
        title={wt.path}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          background: isCurrent ? "var(--bg-selected)" : "transparent",
          border: "none",
          borderRadius: 5,
          color: isCurrent ? "var(--accent)" : "var(--text)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
        }}
        onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
      >
        {isCurrent ? (
          <Check size={12} color="var(--accent)" weight="bold" style={{ flexShrink: 0 }} aria-hidden="true" />
        ) : (
          <span style={{ width: 12, flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>}
      </button>
      {showRemove && (
        <button
          onClick={() => onRemove(false)}
          disabled={busy}
          title={t("desktop.removeWorktree", { path: wt.path })}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 20, padding: 0, marginRight: 4,
            background: "none", border: "none",
            color: "var(--text-dim)", cursor: "pointer",
            borderRadius: 5, flexShrink: 0,
            transition: "color 0.12s, background 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
        >
          <Trash size={12} weight="regular" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function WorktreePanel({
  worktreeState,
  selectedCwd,
  homeDir,
  onSelect,
  onCreate,
  onRemove,
  busy,
  error,
  confirmRemove,
  onConfirmRemoveChange,
}: WorktreePanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);

  // Show the panel for any git top-level — a repo with only the main
  // checkout still gets the current branch + the "new worktree" entry
  // (tabs mode hides all other worktree entry points). Non-git directories
  // and repo subdirectories stay hidden.
  if (!worktreeState || !worktreeState.isGit || !worktreeState.isTopLevel) return null;

  const currentWt = worktreeState.worktrees.find((w) => w.path === selectedCwd)
    ?? worktreeState.worktrees.find((w) => w.isMain)
    ?? null;
  const currentLabel = currentWt
    ? (currentWt.branch ?? displayCwd(currentWt.path, homeDir))
    : "";

  return (
    <div style={{ borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {/* Panel header: the current worktree's label doubles as the title */}
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={() => setOpen((v) => !v)}
          title={currentWt?.path}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            minWidth: 0,
            padding: "6px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textAlign: "left",
          }}
        >
          <CaretRight size={9} weight="regular" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} aria-hidden="true" />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              letterSpacing: 0,
              fontWeight: 500,
            }}
          >
            {currentLabel}
          </span>
        </button>
      </div>

      {open && (
        <div style={{ padding: "0 6px 8px", display: "flex", flexDirection: "column", gap: 2, minHeight: 0 }}>
          {worktreeState.worktrees.map((wt) => {
            const isCurrent = wt.path === selectedCwd
              || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
            return (
              <WorktreeRow
                key={wt.path}
                wt={wt}
                isCurrent={isCurrent}
                showRemove={!wt.isMain}
                busy={busy}
                confirming={confirmRemove === wt.path}
                homeDir={homeDir}
                onSelect={() => onSelect(wt.path)}
                onRemove={(force) => onRemove(wt.path, force)}
                onConfirmChange={(confirming) => onConfirmRemoveChange(confirming ? wt.path : null)}
              />
            );
          })}

          {/* Create worktree */}
          <div style={{ marginTop: 2 }}>
              {!newOpen ? (
                <button
                  onClick={() => { setNewOpen(true); setNewBranch(""); setTimeout(() => newInputRef.current?.focus(), 0); }}
                  title={t("desktop.createWorktree")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "6px 8px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 5,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
                >
                  <Plus size={14} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span>{t("desktop.newWorktree")}</span>
                </button>
              ) : (
                <div style={{ padding: "4px 2px" }}>
                  <input
                    ref={newInputRef}
                    value={newBranch}
                    onChange={(e) => { setNewBranch(e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const branch = newBranch.trim();
                        if (!branch || busy) return;
                        void onCreate(branch).then((ok) => {
                          if (ok) {
                            setNewOpen(false);
                            setNewBranch("");
                          }
                        });
                      }
                      if (e.key === "Escape") {
                        setNewOpen(false);
                        setNewBranch("");
                      }
                    }}
                    placeholder={t("desktop.branchName")}
                    style={{
                      width: "100%",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      padding: "5px 8px",
                      border: "1px solid var(--accent)",
                      borderRadius: 5,
                      outline: "none",
                      background: "var(--bg)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    <button
                      onClick={() => {
                        const branch = newBranch.trim();
                        if (!branch || busy) return;
                        void onCreate(branch).then((ok) => {
                          if (ok) {
                            setNewOpen(false);
                            setNewBranch("");
                          }
                        });
                      }}
                      disabled={busy || !newBranch.trim()}
                      style={{
                        flex: 1,
                        padding: "4px 0",
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: 5,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: busy || !newBranch.trim() ? "not-allowed" : "pointer",
                        opacity: busy || !newBranch.trim() ? 0.65 : 1,
                      }}
                    >
                      {busy ? t("desktop.creating") : t("desktop.create")}
                    </button>
                    <button
                      onClick={() => { setNewOpen(false); setNewBranch(""); }}
                      style={{
                        flex: 1,
                        padding: "4px 0",
                        background: "var(--bg-hover)",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        color: "var(--text-muted)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {t("desktop.cancel")}
                    </button>
                  </div>
                  {error && (
                    <div style={{ marginTop: 5, color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                      {error}
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
