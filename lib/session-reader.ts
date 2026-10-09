import {
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { closeSync, existsSync, fstatSync, openSync, readSync, statSync } from "fs";
import { normalize as normalizePath } from "path";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext, SessionMark } from "./types";
import type { SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { readSubagentRun, SUBAGENT_META_TYPE, SUBAGENT_RESULT_TYPE, type SubagentMetadata, type SubagentResultMetadata } from "./subagents";
import { resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

// Relation reads must not reopen whole session files: a subagent child's
// metadata sits right after the header and its result entry at the tail, so
// two bounded reads answer "who is this and how did it end" for any file size.
const SESSION_RELATION_MAX_BYTES = 256 * 1024;
const SESSION_RELATION_MAX_LINES = 2;
const SESSION_RESULT_MAX_BYTES = 256 * 1024;

function parseSessionEntries(lines: readonly string[]): SessionEntry[] {
  return lines.flatMap((line) => {
    try {
      const entry = JSON.parse(line) as SessionEntry;
      return [entry];
    } catch {
      return [];
    }
  });
}

function readBoundedLines(filePath: string, maxBytes: number, maxLines: number): string[] {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let position = 0;
    let newlineCount = 0;
    let reachedEof = false;

    while (position < maxBytes && newlineCount < maxLines) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        reachedEof = true;
        break;
      }
      position += bytesRead;
      const data = buffer.subarray(0, bytesRead);
      let end = data.length;
      for (let index = 0; index < data.length; index += 1) {
        if (data[index] !== 0x0a) continue;
        newlineCount += 1;
        if (newlineCount === maxLines) {
          end = index + 1;
          break;
        }
      }
      chunks.push(data.subarray(0, end));
    }

    const source = Buffer.concat(chunks).toString("utf8");
    const lines = source.split("\n");
    if (!reachedEof && !source.endsWith("\n")) lines.pop();
    if (lines.at(-1) === "") lines.pop();
    return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  } finally {
    closeSync(fd);
  }
}

function readBoundedTailLines(filePath: string, maxBytes: number): string[] {
  const fd = openSync(filePath, "r");
  try {
    const fileSize = fstatSync(fd).size;
    const start = Math.max(0, fileSize - maxBytes);
    const buffer = Buffer.allocUnsafe(fileSize - start);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, start);
    if (bytesRead === 0) return [];

    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    if (start > 0) {
      const previousByte = Buffer.allocUnsafe(1);
      readSync(fd, previousByte, 0, 1, start - 1);
      if (previousByte[0] !== 0x0a) lines.shift();
    }
    if (lines.at(-1) === "") lines.pop();
    return lines.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  } finally {
    closeSync(fd);
  }
}

function readSessionRelationEntries(filePath: string): SessionEntry[] {
  const prefixEntries = parseSessionEntries(
    readBoundedLines(filePath, SESSION_RELATION_MAX_BYTES, SESSION_RELATION_MAX_LINES).slice(1),
  );
  const isSubagent = prefixEntries.some((entry) => (
    entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE
  ));
  if (!isSubagent) return prefixEntries;

  return [
    ...prefixEntries,
    ...parseSessionEntries(readBoundedTailLines(filePath, SESSION_RESULT_MAX_BYTES)),
  ];
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(normalizePath(s.path), s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(piSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return piSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    const originSessionId = s.parentSessionPath ? pathToId.get(normalizePath(s.parentSessionPath)) : undefined;
    let subagent: ReturnType<typeof readSubagentRun> = null;
    if (s.parentSessionPath) {
      try {
        subagent = readSubagentRun(readSessionRelationEntries(s.path), s.id, s.path);
      } catch { /* malformed or concurrently removed session */ }
    }
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: originSessionId,
      ...(subagent
        ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: subagent.status } }
        : s.parentSessionPath
          ? { relation: { kind: "fork" as const, ...(originSessionId ? { originSessionId } : {}) } }
          : {}),
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.branch ? { branch: project.branch } : {}),
      ...(project?.isWorktree ? { isWorktree: true } : {}),
      ...readSessionFlags(s.path),
    };
  });
}

/**
 * Attach project-root and worktree info to sessions that came from the RPC
 * registry (their cwds were not part of the disk scan's project map).
 */
export async function attachSessionProjectInfo(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));
  return sessions.map((session) => {
    const project = session.cwd ? projectByCwd.get(session.cwd) : undefined;
    return {
      ...session,
      projectRoot: project?.projectRoot ?? session.cwd,
      ...(project?.branch ? { branch: project.branch } : {}),
      ...(project?.isWorktree ? { isWorktree: true } : {}),
    };
  });
}

/**
 * Combine persisted disk sessions with supplemental live ones. A disk scan is
 * authoritative once the JSONL exists, so a transient registry snapshot is
 * replaced without briefly rendering two rows.
 */
export function mergeSessionLists(
  persistedSessions: SessionInfo[],
  supplementalSessions: SessionInfo[],
): SessionInfo[] {
  const byId = new Map(supplementalSessions.map((session) => [session.id, session]));
  for (const session of persistedSessions) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function listAllSessions(options: { force?: boolean } = {}): Promise<SessionInfo[]> {
  if (options.force) invalidateSessionListCache();
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // If a mutation invalidated this scan, make this caller join (or start) a
    // scan for the current generation. Returning the stale result here made a
    // refresh race indistinguishable from a successful refresh.
    if ((globalThis.__piSessionListGeneration ?? 0) !== generation) {
      return listAllSessions();
    }
    globalThis.__piSessionListCache = { data, ts: Date.now() };
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
}

export function getSessionListVersion(): number {
  return globalThis.__piSessionListGeneration ?? 0;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached && existsSync(cached)) return cached;

  // A cached path can outlive its file: a session removed from disk, a fork
  // that rewrote the file under another name, or a transient session whose
  // first flush never happened. The cache has no TTL and every read route
  // trusts it, so an unvalidated hit would turn into a permanent "not found"
  // for an id that still exists. Drop the dead entry and rescan; the scan
  // re-checks the cache generation, so a concurrent mutation is not served
  // stale, and the final existence check rejects a path the fresh list kept.
  if (cached) invalidateSessionPathCache(sessionId);
  await listAllSessions();
  const resolved = getPathCache().get(sessionId) ?? null;
  return resolved && existsSync(resolved) ? resolved : null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = normalizePath(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const pathKey = normalizePath(filePath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousSessionId = reverseCache.get(pathKey);
  if (previousPath && previousPath !== pathKey && reverseCache.get(previousPath) === sessionId) {
    reverseCache.delete(previousPath);
  }
  if (previousSessionId && previousSessionId !== sessionId && pathCache.get(previousSessionId) === pathKey) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, pathKey);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  if (filePath && reverseCache.get(filePath) === sessionId) {
    reverseCache.delete(filePath);
  }
}

/**
 * User-assigned flags for a session file (status mark + pinned), read from
 * its tail in a single scan.
 *
 * Flags are appended as `custom` entries (customType "session-mark" /
 * "session-pin", written by PATCH /api/sessions/[id]) and session files are
 * append-only, so the newest value is always near the end. A trailing
 * `{ mark: null }` entry clears the mark; the last entry wins either way.
 * Only the final 128KB is scanned — large tool results or images further up
 * the file can never hide a flag, since flags are always appended after them.
 */
export interface SessionFlags {
  mark?: SessionMark;
  pinned?: boolean;
}

export function readSessionFlags(filePath: string): SessionFlags {
  const SESSION_MARK_CUSTOM_TYPE = "session-mark";
  const SESSION_PIN_CUSTOM_TYPE = "session-pin";
  const TAIL_BYTES = 128 * 1024;
  try {
    const size = statSync(filePath).size;
    if (size <= 0) return {};
    const readLen = Math.min(size, TAIL_BYTES);
    const fd = openSync(filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(readLen);
      const bytesRead = readSync(fd, buffer, 0, readLen, size - readLen);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      // Drop the first line fragment (it may start mid-line) and scan the rest.
      const newlineIndex = text.indexOf("\n");
      const tail = newlineIndex === -1 ? text : text.slice(newlineIndex + 1);
      const flags: SessionFlags = {};
      for (const line of tail.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as {
            type?: string;
            customType?: string;
            data?: { mark?: SessionMark | null; pinned?: boolean };
          };
          if (entry.type !== "custom") continue;
          if (entry.customType === SESSION_MARK_CUSTOM_TYPE) {
            flags.mark = entry.data?.mark ?? undefined;
          } else if (entry.customType === SESSION_PIN_CUSTOM_TYPE) {
            flags.pinned = entry.data?.pinned === true;
          }
        } catch {
          // skip malformed lines
        }
      }
      return flags;
    } finally {
      closeSync(fd);
    }
  } catch {
    return {};
  }
}

/** Convenience wrapper — latest user-assigned mark, if any. */
export function readSessionMark(filePath: string): SessionMark | undefined {
  return readSessionFlags(filePath).mark;
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine) as SessionHeader;
      return header.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

/**
 * Resolve the thinking level and model in effect at `leafId`.
 *
 * `thinkingLevel` comes from the branch's latest `thinking_level_change`; the
 * model is projected by getRecordedSessionModel from the ACTIVE branch (a plain
 * backward walk can grab a stale response model or miss a branch-local
 * model_change). getSessionSettings always receives the FULL entries array
 * (BuildSessionContext passes `entries`, not the tail window), so slicing the
 * full branch here is safe.
 */
function getSessionSettings(entries: SessionEntry[], leafId?: string | null): Pick<SessionContext, "thinkingLevel" | "model"> {
  if (leafId === null) return { thinkingLevel: "off", model: null };
  const branch = sliceActiveBranch(entries, leafId ?? null, entries.length);
  let thinkingLevel: string | undefined;

  for (let i = branch.length - 1; i >= 0 && thinkingLevel === undefined; i--) {
    const entry = branch[i];
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    }
  }

  return {
    thinkingLevel: thinkingLevel ?? "off",
    // One shared projection: the runtime restore (startRpcSession) reads the
    // exact same recorded value through getRecordedSessionModel.
    model: getRecordedSessionModel(branch),
  };
}

/**
 * The model recorded on the active branch: the latest explicit `model_change`,
 * else the model reported on the nearest assistant response, else null. Sliced
 * from the active branch so runtime restore and display projection agree, and
 * legacy sessions without a `model_change` still restore the model they
 * actually answered with.
 */
export function getRecordedSessionModel(entries: SessionEntry[]): SessionContext["model"] {
  let responseModel: SessionContext["model"] = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "model_change") {
      return { provider: entry.provider, modelId: entry.modelId };
    }
    if (!responseModel && entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message as { provider?: unknown; model?: unknown };
      if (typeof message.provider === "string" && typeof message.model === "string") {
        responseModel = { provider: message.provider, modelId: message.model };
      }
    }
  }
  return responseModel;
}

export interface BuildSessionContextOptions {
  deferThinking?: boolean;
  deferToolResultImages?: boolean;
  tail?: number;
  excludeLeaf?: boolean;
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: BuildSessionContextOptions = {},
): SessionContext {
  const { tail, excludeLeaf } = options;
  // History pages retain the original branch order, including compacted
  // messages: SDK context filtering drops a page's messages whenever the
  // compaction's firstKeptEntryId falls outside the window. Without `tail`
  // the full active branch is returned (legacy behavior).
  const sliced = leafId === null
    ? []
    : sliceActiveBranch(entries, leafId ?? null, tail && tail > 0 ? tail : entries.length, excludeLeaf);
  const hasMore = Boolean(tail && tail > 0 && sliced[0]?.parentId);

  // Convert messages and their IDs together to keep fork/navigation targets aligned.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of sliced) {
    const m = entryToUiMessage(entry, options);
    if (m) {
      messages.push(m);
      entryIds.push(entry.id);
    }
  }

  return {
    messages,
    entryIds,
    oldestEntryId: sliced[0]?.id ?? null,
    hasMore,
    ...getSessionSettings(entries, leafId),
  };
}

/**
 * Extract the ancestor chain from `leafId` back toward the root, capped at
 * `tail` entries (most-recent first after the final reverse). Iterative: a
 * linear session's chain length equals its entry count, so a recursive walk
 * would overflow the stack. The result is still a valid prefix of the active
 * branch — older history is loaded on demand via pagination.
 */
/**
 * A turn boundary in the raw entry chain: a user prompt or a compaction.
 * The chat renderer groups each turn (user prompt + its agent run) through
 * the ProcessGroup path, so a window must start at one of these to render
 * grouped steps. The type check runs before reading `.message` — other entry
 * kinds carry no message.
 */
function isTurnBoundaryEntry(entry: SessionEntry): boolean {
  if (entry.type === "compaction") return true;
  return entry.type === "message" && entry.message.role === "user";
}

/** Extra entries the window may reach back to find a turn boundary. */
export const MAX_TURN_ALIGN_ENTRIES = 50;

/**
 * Entry that renders as a standalone visible message in the chat window:
 * user / assistant messages plus the compaction divider. toolResult entries,
 * transcript system messages (prompt and tool loadout) and session meta render
 * as attachments or nothing, so they must not consume the `tail` budget —
 * counting raw entries starves user messages out of the window in
 * agent-heavy sessions (a 50-entry window over a tool-heavy session can hold
 * a single user message).
 */
function countsTowardTail(entry: SessionEntry): boolean {
  if (entry.type === "compaction") return true;
  if (entry.type !== "message") return false;
  const role = (entry as { message?: { role?: string } }).message?.role;
  return role === "user" || role === "assistant";
}

/**
 * Raw-entry ceiling for one page, so a span of tool traffic with few visible
 * anchors cannot balloon the payload. Scaled with `tail`; older history still
 * pages in via `before`.
 */
const MIN_RAW_WINDOW_ENTRIES = 200;
const rawWindowCap = (tail: number) => Math.max(MIN_RAW_WINDOW_ENTRIES, tail * 6);

export function sliceActiveBranch(
  entries: SessionEntry[],
  leafId: string | null,
  tail: number,
  excludeLeaf = false,
): SessionEntry[] {
  if (tail <= 0) return entries;
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  let leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];
  // Pagination: `before` is the oldest entry already loaded, so the next page
  // must start at its parent to avoid duplicating `before` when prepended.
  if (excludeLeaf) leaf = leaf?.parentId ? byId.get(leaf.parentId) : undefined;
  if (!leaf) return [];
  const chain: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  let visible = 0;
  const rawCap = rawWindowCap(tail);
  while (current) {
    chain.push(current);
    if (countsTowardTail(current)) visible += 1;
    if (visible >= tail || chain.length >= rawCap) {
      // Leave `current` parked at the last pushed entry for the alignment
      // walk below, which starts from its parent.
      current = current.parentId ? byId.get(current.parentId) : undefined;
      break;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  // Align the window start back to a turn boundary so the client's turn
  // grouping sees a valid turn start instead of a mid-run orphan (which would
  // fall back to the flat legacy renderer). Capped: a single turn longer than
  // the budget stays unaligned and is handled by the headless-run grouping.
  // The chain is built leaf-first, so the window start sits at the tail.
  const oldest = chain[chain.length - 1];
  if (oldest && !isTurnBoundaryEntry(oldest)) {
    let aligned = 0;
    while (current && aligned < MAX_TURN_ALIGN_ENTRIES) {
      chain.push(current);
      aligned += 1;
      if (isTurnBoundaryEntry(current)) break;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  chain.reverse();
  return chain;
}

/**
 * Find the first user message across the FULL entry list (session-wide
 * metadata, independent of any tail window). Entries of other types carry no
 * `.message`, so the type guard must run before reading it.
 */
export function findFirstUserMessage(entries: SessionEntry[]): AgentMessage | undefined {
  const firstUserEntry = entries.find(
    (entry): entry is Extract<SessionEntry, { type: "message" }> =>
      entry.type === "message" && entry.message.role === "user",
  );
  const message = firstUserEntry?.message;
  return message && message.role === "user" ? message : undefined;
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      // Transcript system messages carry the prompt and tool loadout (Pi >= 0.86).
      // They are provider input, not conversation, so they never render.
      if (entry.message.role === "system") return null;
      let message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      // Real long sessions may store assistant content as a plain string; the
      // deferThinking branch maps over content blocks and would 500 (#555).
      const legacyContent = message.role === "assistant" ? (message as { content: unknown }).content : undefined;
      if (typeof legacyContent === "string") {
        message = { ...message, content: [{ type: "text", text: legacyContent }] } as AgentMessage;
      }
      if (!options.deferThinking || message.role !== "assistant") return message;
      const content = message.content;
      return {
        ...message,
        content: content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom": {
      // Subagent sessions carry their task definition and outcome as plain
      // custom entries (appendCustomEntry), not custom_message entries. Map
      // them to custom UI messages so opening a subagent session shows what
      // it was asked to do and what it returned. Unknown custom entry types
      // stay hidden, matching the pre-subagent behavior.
      if (entry.customType !== SUBAGENT_META_TYPE && entry.customType !== SUBAGENT_RESULT_TYPE) return null;
      const data = entry.data as Partial<SubagentMetadata> & Partial<SubagentResultMetadata> | undefined;
      const isMeta = entry.customType === SUBAGENT_META_TYPE;
      const task = typeof data?.task === "string" ? data.task : "";
      const result = typeof data?.result === "string" ? data.result : "";
      const error = typeof data?.error === "string" ? data.error : "";
      const content = isMeta
        ? task || (typeof data?.description === "string" ? data.description : "")
        : result || error;
      return {
        role: "custom",
        customType: entry.customType,
        content,
        display: true,
        details: data,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    }
    default:
      return null;
  }
}
