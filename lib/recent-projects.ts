/**
 * Recent-project detection across other editors and coding agents.
 *
 * Reads "recently opened workspaces" from the local data of VS Code-family
 * editors (Code/Cursor/Windsurf/Trae/…), Zed, Claude Code, OpenAI Codex and
 * OpenCode, so the welcome lobby can offer the user's existing projects.
 *
 * Rules (agreed with the user):
 * - Read-only, never writes to other applications' data.
 * - Honest presentation: no filtering against pi's own workspaces, no
 *   "already added" markers, duplicates across sources are fine (they are
 *   deduped by path keeping the newest timestamp).
 * - Sources that cannot be read (missing dirs, locked dbs, no node:sqlite
 *   support) are skipped silently — every source is best-effort.
 *
 * SQLite reads use node:sqlite (Electron 43 ships Node 24 where it is
 * stable). On Node <23.4 it requires --experimental-sqlite; when unavailable
 * the JSON sources (VS Code storage.json, Claude Code history) still work and
 * SQLite sources degrade to nothing.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";

export type RecentProjectSource = "vscode" | "zed" | "claude" | "codex" | "opencode";

export interface RecentProject {
  /** Normalized absolute local path (forward slashes). */
  path: string;
  source: RecentProjectSource;
  /** Last-used timestamp in ms, or null when the source has no timestamp
   *  (VS Code MRU entries carry none). Null times sort last. */
  timeMs: number | null;
}

/** Lazily-imported node:sqlite; undefined when unsupported. */
type SqliteModule = typeof import("node:sqlite") | undefined;
let sqliteModulePromise: Promise<SqliteModule> | null = null;
function loadSqlite(): Promise<SqliteModule> {
  sqliteModulePromise ??= (async () => {
    try {
      return await import("node:sqlite");
    } catch {
      return undefined;
    }
  })();
  return sqliteModulePromise;
}

/** Case-insensitive path comparison for dedupe (Windows paths are case-insensitive). */
function pathKey(p: string): string {
  return p.toLowerCase();
}

/** Decode a file:// URI to a local path; non-file URIs (remote workspaces) return null. */
export function normalizeFileUri(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  try {
    const decoded = decodeURIComponent(uri);
    // file:///E:/Dev/x  ->  /E:/Dev/x (POSIX-style leading slash); strip it.
    return normalizePath(decoded.replace(/^file:\/\/\/?/, ""));
  } catch {
    return null;
  }
}

/** Forward-slash + trailing-slash normalization; empty input becomes null. */
export function normalizePath(p: string): string | null {
  const cleaned = p.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Dedupe by path (case-insensitive), keeping the newest timestamp, and sort by
 * time descending — unknown times (null) sink to the bottom while preserving
 * their relative order (e.g. VS Code MRU order).
 */
export function dedupeAndSort(projects: RecentProject[]): RecentProject[] {
  const byPath = new Map<string, RecentProject>();
  for (const p of projects) {
    const key = pathKey(p.path);
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, p);
      continue;
    }
    const existingTime = existing.timeMs ?? -Infinity;
    const newTime = p.timeMs ?? -Infinity;
    if (newTime > existingTime) byPath.set(key, p);
  }
  return [...byPath.values()].sort((a, b) => {
    const at = a.timeMs ?? -Infinity;
    const bt = b.timeMs ?? -Infinity;
    if (at !== bt) return bt - at;
    // Stable-ish tie-break: keep insertion order for equal timestamps.
    return 0;
  });
}

// ─── VS Code family ──────────────────────────────────────────────────────────

/** Product directories sharing the Code-OSS layout, newest first. */
const VSCODE_PRODUCTS = ["Code", "Cursor", "Windsurf", "Trae", "VSCodium", "Positron", "Codium"];

/** VS Code user-data root for the current platform (Windows: %APPDATA%). */
export function vscodeUserRoots(appData?: string): string[] {
  const platformRoot = appData ?? (process.platform === "win32"
    ? process.env.APPDATA ?? ""
    : process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : path.join(homedir(), ".config"));
  if (!platformRoot) return [];
  return VSCODE_PRODUCTS.map((name) => path.join(platformRoot, name, "User")).filter((p) => existsSync(p));
}

/**
 * Read the authoritative recents from state.vscdb (key
 * history.recentlyOpenedPathsList) plus the legacy storage.json
 * (openedPathsList) and the workspaceStorage folder list (real mtimes).
 */
export async function readVSCodeRecents(userRoots: string[]): Promise<RecentProject[]> {
  const out: RecentProject[] = [];
  for (const userRoot of userRoots) {
    const source: RecentProjectSource = "vscode";
    // 1) SQLite application storage (authoritative in VS Code 42+).
    const sqlite = await loadSqlite();
    if (sqlite) {
      const dbPath = path.join(userRoot, "globalStorage", "state.vscdb");
      if (existsSync(dbPath)) {
        try {
          const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
          try {
            const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("history.recentlyOpenedPathsList") as { value?: unknown } | undefined;
            if (row && typeof row.value === "string") {
              const parsed = JSON.parse(row.value) as { entries?: Array<{ folderUri?: string; remoteAuthority?: string }> };
              for (const e of parsed.entries ?? []) {
                if (!e.folderUri || e.remoteAuthority) continue; // skip remote workspaces
                const p = normalizeFileUri(e.folderUri);
                if (p) out.push({ path: p, source, timeMs: null });
              }
            }
          } finally {
            db.close();
          }
        } catch {
          // locked/unreadable — fall through to the JSON sources
        }
      }
    }
    // 2) Legacy storage.json.
    const jsonPath = path.join(userRoot, "globalStorage", "storage.json");
    if (existsSync(jsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as { openedPathsList?: { entries?: Array<{ folderUri?: string; remoteAuthority?: string }> } };
        for (const e of parsed.openedPathsList?.entries ?? []) {
          if (!e.folderUri || e.remoteAuthority) continue;
          const p = normalizeFileUri(e.folderUri);
          if (p) out.push({ path: p, source, timeMs: null });
        }
      } catch {
        // malformed — ignore
      }
    }
    // 3) workspaceStorage/<hash>/workspace.json — real mtimes, no MRU order.
    const wsRoot = path.join(userRoot, "workspaceStorage");
    if (existsSync(wsRoot)) {
      for (const hashDir of readdirSync(wsRoot)) {
        const wsFile = path.join(wsRoot, hashDir, "workspace.json");
        if (!existsSync(wsFile)) continue;
        try {
          const parsed = JSON.parse(readFileSync(wsFile, "utf8")) as { folder?: string; workspace?: string };
          const uri = parsed.folder ?? parsed.workspace;
          if (!uri) continue;
          const p = normalizeFileUri(uri);
          if (p) out.push({ path: p, source, timeMs: statSync(wsFile).mtimeMs });
        } catch {
          // ignore
        }
      }
    }
  }
  return out;
}

// ─── Zed ─────────────────────────────────────────────────────────────────────

export function zedDbPath(localAppData?: string): string | null {
  const root = localAppData ?? (process.platform === "win32"
    ? process.env.LOCALAPPDATA ?? ""
    : process.platform === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : path.join(homedir(), ".local", "share"));
  if (!root) return null;
  const p = path.join(root, "Zed", "db", "0-stable", "db.sqlite");
  return existsSync(p) ? p : null;
}

/**
 * Read Zed's workspaces table. The db is WAL and may be in use by a running
 * Zed; opening with immutable=1 reads the main file without touching the
 * WAL/locks (a few un-checkpointed rows may be missed — fine for recents).
 */
export async function readZedRecents(dbPath: string): Promise<RecentProject[]> {
  const sqlite = await loadSqlite();
  if (!sqlite) return [];
  const out: RecentProject[] = [];
  try {
    const uri = "file:" + dbPath.replace(/\\/g, "/") + "?immutable=1";
    const db = new sqlite.DatabaseSync(uri, { readOnly: true });
    try {
      const rows = db.prepare("SELECT paths, timestamp FROM workspaces").all() as Array<{ paths: string; timestamp: string }>;
      for (const row of rows) {
        const firstPath = normalizePath((row.paths ?? "").split(",")[0] ?? "");
        if (!firstPath) continue;
        const timeMs = Date.parse(row.timestamp);
        out.push({ path: firstPath, source: "zed", timeMs: Number.isNaN(timeMs) ? null : timeMs });
      }
    } finally {
      db.close();
    }
  } catch {
    // locked or schema changed — skip
  }
  return out;
}

// ─── Claude Code ─────────────────────────────────────────────────────────────

/** Read ~/.claude/history.jsonl — a natural MRU: {project, timestamp(ms)}. */
export async function readClaudeRecents(home?: string): Promise<RecentProject[]> {
  const root = home ?? homedir();
  const historyPath = path.join(root, ".claude", "history.jsonl");
  if (!existsSync(historyPath)) return [];
  const out: RecentProject[] = [];
  try {
    const lines = readFileSync(historyPath, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { project?: string; timestamp?: number };
        const p = normalizePath(entry.project ?? "");
        if (!p) continue;
        out.push({ path: p, source: "claude", timeMs: typeof entry.timestamp === "number" ? entry.timestamp : null });
      } catch {
        // malformed line — skip
      }
    }
  } catch {
    // unreadable — skip
  }
  return out;
}

// ─── OpenAI Codex ────────────────────────────────────────────────────────────

const CODEX_MAX_FILES = 100;

/**
 * Read Codex session files: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
 * Every file starts with a session_meta line carrying the cwd; only the most
 * recently modified files are inspected (first line read via a bounded read).
 */
export async function readCodexRecents(home?: string): Promise<RecentProject[]> {
  const root = home ?? homedir();
  const sessionsRoot = path.join(root, ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return [];
  const out: RecentProject[] = [];
  try {
    const files: Array<{ file: string; mtime: number }> = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        let st: ReturnType<typeof statSync>;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) walk(full);
        else if (name.endsWith(".jsonl")) files.push({ file: full, mtime: st.mtimeMs });
      }
    };
    walk(sessionsRoot);
    // Archived sessions carry the same shape.
    const archivedRoot = path.join(root, ".codex", "archived_sessions");
    if (existsSync(archivedRoot)) {
      for (const name of readdirSync(archivedRoot)) {
        const full = path.join(archivedRoot, name);
        if (!name.endsWith(".jsonl")) continue;
        try { files.push({ file: full, mtime: statSync(full).mtimeMs }); } catch { /* ignore */ }
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    for (const { file } of files.slice(0, CODEX_MAX_FILES)) {
      try {
        const head = readHead(file, 16 * 1024);
        const firstLine = head.split("\n")[0] ?? "";
        if (!firstLine.trim()) continue;
        const meta = JSON.parse(firstLine) as { type?: string; payload?: { cwd?: string; timestamp?: string } };
        if (meta.type !== "session_meta") continue;
        const p = normalizePath(meta.payload?.cwd ?? "");
        if (!p) continue;
        const timeMs = meta.payload?.timestamp ? Date.parse(meta.payload.timestamp) : NaN;
        out.push({ path: p, source: "codex", timeMs: Number.isNaN(timeMs) ? null : timeMs });
      } catch {
        // unreadable/malformed — skip
      }
    }
  } catch {
    // unreadable — skip
  }
  return out;
}

function readHead(file: string, maxBytes: number): string {
  const fd = openSyncSafe(file);
  if (fd === null) return "";
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = readSyncSafe(fd, buf, 0, maxBytes, 0);
    return n > 0 ? buf.subarray(0, n).toString("utf8") : "";
  } finally {
    closeSafe(fd);
  }
}

// fs sync helpers that never throw (best-effort reads)
function openSyncSafe(file: string) {
  try { return openSync(file, "r"); } catch { return null; }
}
function readSyncSafe(fd: number, buf: Buffer, pos: number, len: number, off: number) {
  try { return readSync(fd, buf, pos, len, off); } catch { return 0; }
}
function closeSafe(fd: number) {
  try { closeSync(fd); } catch { /* ignore */ }
}

// ─── OpenCode ────────────────────────────────────────────────────────────────

/** OpenCode data root: ~/.local/share/opencode (XDG data home, even on Windows). */
export function openCodeDbPath(dataRoot?: string): string | null {
  const root = dataRoot ?? (process.platform === "win32" || process.platform === "linux"
    ? path.join(homedir(), ".local", "share", "opencode")
    : path.join(homedir(), "Library", "Application Support", "opencode"));
  const p = path.join(root, "opencode.db");
  return existsSync(p) ? p : null;
}

/**
 * Read OpenCode's session table (directory + time_updated). The db can be
 * large (hundreds of MB) and in WAL use by a running OpenCode, so it is read
 * with immutable=1 — never copied, never locked.
 */
export async function readOpenCodeRecents(dbPath: string): Promise<RecentProject[]> {
  const sqlite = await loadSqlite();
  if (!sqlite) return [];
  const out: RecentProject[] = [];
  try {
    const uri = "file:" + dbPath.replace(/\\/g, "/") + "?immutable=1";
    const db = new sqlite.DatabaseSync(uri, { readOnly: true });
    try {
      const rows = db.prepare(
        "SELECT directory, MAX(time_updated) AS t FROM session WHERE directory IS NOT NULL AND directory != '' GROUP BY directory ORDER BY t DESC",
      ).all() as Array<{ directory: string; t: number | null }>;
      for (const row of rows) {
        const p = normalizePath(row.directory);
        if (!p) continue;
        out.push({ path: p, source: "opencode", timeMs: typeof row.t === "number" ? row.t : null });
      }
    } finally {
      db.close();
    }
  } catch {
    // locked/schema changed — skip
  }
  return out;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/** Collect and merge every available source into one sorted list. */
export async function collectRecentProjects(): Promise<RecentProject[]> {
  const sources = await Promise.all([
    readVSCodeRecents(vscodeUserRoots()),
    readZedRecents(zedDbPath() ?? ""),
    readClaudeRecents(),
    readCodexRecents(),
    readOpenCodeRecents(openCodeDbPath() ?? ""),
  ]);
  const merged: RecentProject[] = [];
  for (const list of sources) {
    for (const p of list) {
      // Keep only existing directories — pi opens workspaces, not files
      // (workspaceStorage may yield .code-workspace files).
      try {
        if (!statSync(p.path).isDirectory()) continue;
      } catch {
        continue;
      }
      merged.push(p);
    }
  }
  return dedupeAndSort(merged);
}
