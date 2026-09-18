import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  buildSessionContext,
  findFirstUserMessage,
  listAllSessions,
  mergeSessionLists,
  readSessionHeader,
} from "@/lib/session-reader";
import { abortSubagent, getRpcSession, getRpcSessionInfos } from "@/lib/rpc-manager";
import { readSubagentRun, SUBAGENT_META_TYPE } from "@/lib/subagents";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { computeSessionStats } from "@/lib/session-stats";
import type { SessionEntry, SessionMark } from "@/lib/types";

const SESSION_MARKS: readonly SessionMark[] = ["completed", "discussion", "pending", "abandoned"];

// BranchNavigator still traverses recursively, so keep the response tree shallow.
const MAX_PROJECTED_TREE_DEPTH = 200;

/**
 * Project the session tree into the shallow navigation tree sent to the client.
 * Keeps roots, branch points, and leaves while contracting single-child chains
 * without recursive traversal. Contracted entry IDs are attached to the next
 * visible node so the UI can still recognize an active leaf inside the chain.
 */
function projectTreeForResponse<T extends { entry: { id: string }; children: T[]; compressedEntryIds?: string[] }>(
  nodes: T[]
): T[] {
  const keep = new Set<T>();
  const roots = new Set(nodes);
  const seen = new Set<T>();
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);

    if (
      roots.has(node) ||
      node.children.length !== 1
    ) {
      keep.add(node);
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  const cloneNode = (node: T, compressedEntryIds?: string[]): T => ({
    ...node,
    children: [],
    ...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
  });
  const projectedRoots = nodes.map((node) => cloneNode(node));
  const tasks = nodes.map((source, index) => ({
    source,
    projected: projectedRoots[index],
    depth: 1,
  }));

  const appendFlattenedKeptDescendants = (source: T, projectedParent: T) => {
    const pending = [{ node: source, compressedEntryIds: [] as string[] }];
    const flattenedSeen = new Set<T>();

    while (pending.length > 0) {
      const { node, compressedEntryIds } = pending.pop()!;
      if (flattenedSeen.has(node)) continue;
      flattenedSeen.add(node);

      if (keep.has(node)) {
        projectedParent.children.push(cloneNode(node, compressedEntryIds));
      }

      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push({
          node: node.children[i],
          compressedEntryIds: keep.has(node)
            ? []
            : [...compressedEntryIds, node.entry.id],
        });
      }
    }
  };

  while (tasks.length > 0) {
    const { source, projected, depth } = tasks.pop()!;

    for (const sourceChild of source.children) {
      let child = sourceChild;

      if (depth >= MAX_PROJECTED_TREE_DEPTH) {
        appendFlattenedKeptDescendants(child, projected);
        continue;
      }

      const compressedEntryIds: string[] = [];
      while (!keep.has(child) && child.children.length === 1) {
        compressedEntryIds.push(child.entry.id);
        child = child.children[0];
      }

      if (!keep.has(child)) {
        continue;
      }

      const projectedChild = cloneNode(child, compressedEntryIds);
      projected.children.push(projectedChild);
      tasks.push({ source: child, projected: projectedChild, depth: depth + 1 });
    }
  }

  return projectedRoots;
}

// Cumulative usage across ALL session-file entries — the same aggregation the
// SDK's getSessionStats() uses. Lets the client keep monotonic token/cost
// counters across compaction and page reloads. The last model in use feeds
// the notification popup (model + cost for background sessions).
function summarizeSessionFile(entries: unknown[]) {
  const fileStats = computeSessionStats(entries as SessionEntry[]);
  let popupModel: { provider: string; modelId: string } | null = null;
  for (const entry of entries as Array<Record<string, unknown>>) {
    if (entry.type === "model_change") {
      popupModel = { provider: String(entry.provider ?? ""), modelId: String(entry.modelId ?? "") };
    }
  }
  return { fileStats, popupModel };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const searchParams = new URL(req.url).searchParams;
    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(resolvedPath!);
    const filePath = liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
    // Meta-only probe: proves whether the session file has changed since a
    // cached snapshot was taken (mtime), without parsing the session file.
    // Used by the client session cache to skip the full reload when fresh.
    if (searchParams.has("meta")) {
      try {
        const modified = statSync(filePath).mtime.toISOString();
        return NextResponse.json({ sessionId: id, exists: true, modified });
      } catch {
        return NextResponse.json({ sessionId: id, exists: false, modified: null });
      }
    }

    const entries = sm.getEntries();
    const leafId = sm.getLeafId();
    const tree = projectTreeForResponse(sm.getTree());
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    // ?tail bounds the returned ancestor chain (capped at 1000) for clients
    // that page explicitly. Absent tail keeps the legacy full-chain response;
    // the tail-pagination experiment lives on the exp/tail-pagination branch.
    const rawTail = Number(searchParams.get("tail"));
    const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : undefined;
    const context = buildSessionContext(entries as never, leafId, { deferThinking, deferToolResultImages, tail });
    const totalActiveMs = computeSessionTotalActiveMs(entries);
    const { fileStats, popupModel } = summarizeSessionFile(entries);

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const subagent = header
      ? readSubagentRun(entries as never, header.id, filePath)
      : null;
    // messageCount/firstMessage describe the whole session, so derive them from
    // the full entries — the tail-sliced context only carries the last page.
    const firstUserMessage = findFirstUserMessage(entries as never);
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      messageCount: fileStats.totalMessages,
      firstMessage: firstUserMessage
        ? (() => {
            const c = (firstUserMessage as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      ...(subagent ? {
        relation: {
          kind: "subagent" as const,
          parentSessionId: subagent.parentSessionId,
          profile: subagent.profile,
          description: subagent.description,
          status: liveRpc?.isRunning() ? "running" as const : subagent.status,
        },
      } : {}),
      transient: !filePath || !existsSync(filePath),
    } : null;

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      // Estimated active (non-idle) wall-clock time across the session file.
      totalActiveMs,
      // Completion stats for the notification popup (model + accumulated cost).
      stats: { model: popupModel, cost: fileStats.cost, tokens: fileStats.tokens },
      // Cumulative all-entries stats for monotonic live counters.
      fileStats,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name?: string, mark?: SessionMark | null, pin?: boolean }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name, mark, pin } = await req.json() as { name?: string; mark?: SessionMark | null; pin?: boolean };
    if (typeof name !== "string" && mark === undefined && pin === undefined) {
      return NextResponse.json({ error: "name, mark or pin is required" }, { status: 400 });
    }
    if (mark !== undefined && mark !== null && !SESSION_MARKS.includes(mark)) {
      return NextResponse.json({ error: "invalid mark" }, { status: 400 });
    }
    if (pin !== undefined && typeof pin !== "boolean") {
      return NextResponse.json({ error: "invalid pin" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    if (typeof name === "string") {
      sm.appendSessionInfo(name.trim());
    }
    if (mark !== undefined) {
      // Append-only custom entry; the latest entry wins when reading (null clears).
      sm.appendCustomEntry("session-mark", { mark });
    }
    if (pin !== undefined) {
      // Append-only custom entry; the latest entry wins when reading (false clears).
      sm.appendCustomEntry("session-pin", { pinned: pin });
    }
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    let parentSessionPath: string | undefined;
    try {
      parentSessionPath = readSessionHeader(filePath)?.parentSession;
    } catch (error) {
      // Empty runtime sessions have a cached path before their first disk write.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let parentSessionId: string | undefined;
    if (parentSessionPath) {
      try {
        // The parent may have been deleted or moved already; treat it as absent.
        parentSessionId = readSessionHeader(parentSessionPath)?.id;
      } catch {
        parentSessionId = undefined;
      }
    }

    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    // Paths may be expressed differently by git/listers and the filesystem, so
    // normalise to forward slashes for membership checks below.
    const pathKey = (p: string) => p.replace(/\\+/g, "/");
    const targetPathKey = pathKey(filePath);

    // Deleting a session also deletes every persisted or live subagent below it.
    // Collect the subagent family tree from the catalogue (plus a local dir scan
    // so stale/incomplete caches still find siblings), then unlink each member.
    const sessions = mergeSessionLists(
      await listAllSessions({ force: true }),
      getRpcSessionInfos({ includeTransient: true }),
    );
    const childrenByParent = new Map<string, string[]>();
    for (const session of sessions) {
      if (session.relation?.kind !== "subagent") continue;
      const children = childrenByParent.get(session.relation.parentSessionId) ?? [];
      children.push(session.id);
      childrenByParent.set(session.relation.parentSessionId, children);
    }
    const sessionPaths = new Map(sessions.map((session) => [session.id, session.path]));
    // Include local files even when the global catalogue is stale or incomplete.
    try {
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
        const childPath = join(dir, file);
        if (pathKey(childPath) === targetPathKey) continue;
        try {
          const lines = readFileSync(childPath, "utf8").split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; id?: string };
          if (header.type !== "session" || typeof header.id !== "string") continue;
          const entries = lines.slice(1).flatMap((line) => {
            try { return [JSON.parse(line) as SessionEntry]; } catch { return []; }
          });
          const subagent = readSubagentRun(entries, header.id, childPath);
          if (!subagent) continue;
          const children = childrenByParent.get(subagent.parentSessionId) ?? [];
          children.push(header.id);
          childrenByParent.set(subagent.parentSessionId, children);
          sessionPaths.set(header.id, childPath);
        } catch { /* skip malformed or concurrently removed sessions */ }
      }
    } catch { /* skip if dir unreadable */ }
    const deletedSessionIds = new Set<string>([id]);
    const pending = [id];
    while (pending.length > 0) {
      const parentId = pending.pop()!;
      for (const childId of childrenByParent.get(parentId) ?? []) {
        if (deletedSessionIds.has(childId)) continue;
        deletedSessionIds.add(childId);
        pending.push(childId);
      }
    }
    const deletedPaths = new Map<string, string>([[id, filePath]]);
    for (const deletedId of deletedSessionIds) {
      const sessionPath = sessionPaths.get(deletedId);
      if (sessionPath) deletedPaths.set(deletedId, sessionPath);
    }
    for (const deletedId of deletedSessionIds) {
      if (deletedPaths.has(deletedId)) continue;
      const runtimePath = getRpcSession(deletedId)?.sessionFile;
      if (runtimePath) deletedPaths.set(deletedId, runtimePath);
      else {
        const resolvedPath = await resolveSessionPath(deletedId);
        if (resolvedPath) deletedPaths.set(deletedId, resolvedPath);
      }
    }
    const deletedPathKeys = new Set([...deletedPaths.values()].map(pathKey));

    // Non-subagent children (e.g. forks) are re-attached to this session's parent.
    // Subagent descendants were deleted above and must be skipped here.
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files) {
        const childPath = join(dir, file);
        if (pathKey(childPath) === targetPathKey || deletedPathKeys.has(pathKey(childPath))) continue;
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
          if (header.type === "session" && pathKey(header.parentSession ?? "") === targetPathKey) {
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            // Keep a reparented subagent's metadata entry pointing at the new
            // parent, or its relation and completion notification would follow
            // the deleted file.
            if (parentSessionPath && parentSessionId) {
              for (let index = 1; index < lines.length; index += 1) {
                let entry: { type?: string; customType?: string; data?: unknown };
                try {
                  entry = JSON.parse(lines[index]);
                } catch {
                  continue;
                }
                if (
                  entry.type !== "custom"
                  || entry.customType !== SUBAGENT_META_TYPE
                  || typeof entry.data !== "object"
                  || entry.data === null
                  || Array.isArray(entry.data)
                ) continue;
                entry.data = {
                  ...entry.data,
                  parentSessionId,
                  parentSessionPath,
                };
                lines[index] = JSON.stringify(entry);
                break;
              }
            }
            writeFileSync(childPath, lines.join("\n"));
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if dir unreadable */ }

    // Terminate and shut down every deleted descendant before unlinking, so a
    // running subagent cannot keep writing to a file about to be removed.
    for (const deletedId of [...deletedSessionIds].reverse()) {
      if (deletedId === id) continue;
      try { await abortSubagent(deletedId); } catch { /* idle or completed */ }
      await getRpcSession(deletedId)?.shutdown();
    }
    try { await abortSubagent(id); } catch { /* ordinary session */ }
    await getRpcSession(id)?.shutdown();
    for (const [deletedId, deletedPath] of deletedPaths) {
      try {
        unlinkSync(deletedPath);
      } catch (error) {
        // The session may never have been written to disk (cached runtime path).
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      invalidateSessionPathCache(deletedId);
    }
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
