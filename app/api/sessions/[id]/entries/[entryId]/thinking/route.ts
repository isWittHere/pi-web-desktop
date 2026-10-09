import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

/**
 * Deferred long-form content for one assistant thinking block.
 *
 * The session page renders from the LIVE wrapper's in-memory SessionManager
 * whenever one exists (see /api/sessions/[id] and .../context), because the SDK
 * can hold entries the JSONL does not have yet: it flushes on its own schedule,
 * and a fork rewrites the file header. Reading only disk here would report an
 * entry the user can see on screen as missing, which surfaces as a bare
 * "HTTP 404" inside the expanded thinking block. Resolve the same source the
 * page rendered from, then fall back to disk before reporting a miss.
 *
 * The 404 body carries a `reason` so a miss is diagnosable from the response
 * alone instead of requiring a server log.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  const blockIndex = blockIndexParam === null ? Number.NaN : Number(blockIndexParam);
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    return NextResponse.json({ error: "Valid blockIndex is required", reason: "bad-index" }, { status: 400 });
  }

  try {
    const rpc = getRpcSession(id);
    const liveManager = rpc?.isAlive() ? rpc.inner.sessionManager : undefined;

    let entries: SessionEntry[] | null = liveManager
      ? (liveManager.getEntries() as unknown as SessionEntry[])
      : null;
    let filePath: string | null = null;

    if (!entries) {
      filePath = await resolveSessionPath(id);
      if (!filePath) {
        return NextResponse.json({ error: "Session not found", reason: "no-session" }, { status: 404 });
      }
      // SessionManager-backed parsing preserves the SDK's malformed-line tolerance.
      entries = SessionManager.open(filePath).getEntries() as unknown as SessionEntry[];
    }

    let entry = entries.find((candidate) => candidate.id === entryId);
    // The live manager and the file can briefly disagree (SDK flush timing, a
    // fork that rewrote the header); check the other source before giving up.
    if (!entry) {
      filePath ??= await resolveSessionPath(id);
      if (filePath) {
        entry = (SessionManager.open(filePath).getEntries() as unknown as SessionEntry[])
          .find((candidate) => candidate.id === entryId);
      }
    }

    if (!entry || entry.type !== "message" || entry.message.role !== "assistant") {
      return NextResponse.json({ error: "Assistant message not found", reason: "no-entry" }, { status: 404 });
    }

    const block = entry.message.content[blockIndex];
    if (!block || block.type !== "thinking") {
      return NextResponse.json({ error: "Thinking block not found", reason: "no-thinking" }, { status: 404 });
    }

    return NextResponse.json({ thinking: block.thinking });
  } catch (error) {
    return NextResponse.json({ error: String(error), reason: "error" }, { status: 500 });
  }
}
