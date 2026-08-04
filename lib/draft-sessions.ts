import type { SessionInfo } from "./types";

/**
 * Draft session store — pi-web's own "unsent session" placeholder.
 *
 * A draft is a pure client-side record (localStorage) that appears in the
 * sidebar session list BEFORE the first message is sent. It has no pi session
 * behind it: no session file, no in-memory AgentSession. When the user sends
 * the first message the draft is promoted (removed from this store) and the
 * real session takes over — the server persists the session file immediately
 * on the prompt command (see rpc-manager persistPromptSession), so the disk
 * list picks it up on the next refresh.
 */

export interface DraftSession {
  id: string;
  cwd: string;
  name?: string;
  createdAt: string;
  modifiedAt: string;
}

const STORAGE_KEY = "pi-web:draft-sessions";

function isDraftSession(value: unknown): value is DraftSession {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d.id === "string"
    && typeof d.cwd === "string"
    && typeof d.createdAt === "string"
    && typeof d.modifiedAt === "string";
}

export function loadDraftSessions(): DraftSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDraftSession);
  } catch {
    return [];
  }
}

export function saveDraftSessions(drafts: DraftSession[]): void {
  if (typeof window === "undefined") return;
  try {
    if (drafts.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Storage quota / privacy mode — drafts just won't survive a refresh.
  }
}

export function createDraftSession(cwd: string, id?: string): DraftSession {
  const now = new Date().toISOString();
  const generated = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    id: id ?? generated,
    cwd,
    createdAt: now,
    modifiedAt: now,
  };
}

export function removeDraftSession(drafts: DraftSession[], id: string): DraftSession[] {
  return drafts.filter((d) => d.id !== id);
}

export function renameDraftSession(drafts: DraftSession[], id: string, name: string): DraftSession[] {
  return drafts.map((d) => (d.id === id ? { ...d, name, modifiedAt: new Date().toISOString() } : d));
}

export function touchDraftSession(drafts: DraftSession[], id: string): DraftSession[] {
  return drafts.map((d) => (d.id === id ? { ...d, modifiedAt: new Date().toISOString() } : d));
}

/** Convert a draft into the SessionInfo shape the sidebar renders as a row. */
export function draftToSessionInfo(draft: DraftSession): SessionInfo {
  return {
    path: "",
    id: draft.id,
    cwd: draft.cwd,
    name: draft.name,
    created: draft.createdAt,
    modified: draft.modifiedAt,
    messageCount: 0,
    firstMessage: "",
    projectRoot: draft.cwd,
  };
}
