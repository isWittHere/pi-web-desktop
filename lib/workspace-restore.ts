/**
 * Workspace-restore decision logic (pure, testable).
 *
 * Switching to a workspace decides what to open: the remembered draft, the
 * remembered session, the workspace's most recent session (when the memory is
 * missing or stale — e.g. entering an existing workspace from the lobby), or
 * a fresh welcome draft (workspace with no sessions at all). All the
 * "try memory → fall back to latest → fall back to blank" branching lives
 * here so AppShell only applies the decision, and regressions in the fallback
 * order are caught by tests.
 */

import type { SessionInfo } from "@/lib/types";
import { samePath } from "./path-match";
import type { LastOpenEntry } from "./workspace-memory";

/** What to show after moving into a workspace. */
export type RestoreTarget =
  | { kind: "draft"; draft: { id: string; cwd: string } }
  | { kind: "session"; session: SessionInfo }
  | { kind: "new-draft"; cwd: string };

export interface RestoreInput {
  /** Workspace identity (project root when known, else cwd). */
  projectKey: string;
  /** The effective cwd being restored into. */
  cwd: string;
  /** The remembered context, or null when never stored / storage unavailable. */
  lastOpen: LastOpenEntry | null;
  drafts: Array<{ id: string; cwd: string }>;
  sessions: SessionInfo[];
}

/**
 * Resolve the target for a workspace with the full session list available.
 * Callers should handle the remembered-draft branch synchronously (drafts are
 * local state, no session list needed); the session/latest/new-draft branches
 * need the session list and go through this function.
 */
export function resolveRestoreTarget(ctx: RestoreInput): RestoreTarget {
  const { projectKey, cwd, lastOpen, drafts, sessions } = ctx;

  // Remembered draft: reopen it verbatim. A stale id (draft deleted) falls
  // through to the session branches.
  if (lastOpen?.kind === "draft") {
    const draft = drafts.find((d) => d.id === lastOpen.id);
    if (draft) return { kind: "draft", draft };
  }

  // Remembered session: reopen it when it still exists and still belongs to
  // this workspace. A stale/deleted/drifted session falls through to latest.
  if (lastOpen?.kind === "session") {
    const session = sessions.find((s) => s.id === lastOpen.id);
    if (session && samePath(session.projectRoot ?? session.cwd, projectKey)) {
      return { kind: "session", session };
    }
  }

  // No usable memory — pick the workspace's most recently modified session so
  // entering an existing workspace (e.g. from the lobby) restores real
  // history instead of a blank draft. Only a workspace with no sessions at
  // all gets a fresh welcome draft.
  const latest = sessions
    .filter((s) => samePath(s.projectRoot ?? s.cwd, projectKey))
    .sort((a, b) => b.modified.localeCompare(a.modified))[0];
  if (latest) return { kind: "session", session: latest };

  return { kind: "new-draft", cwd };
}