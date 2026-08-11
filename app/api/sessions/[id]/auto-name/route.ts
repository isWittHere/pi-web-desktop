import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  buildSessionContext,
  invalidateSessionListCache,
} from "@/lib/session-reader";
import {
  extractRecentTurns,
  generateSessionTitle,
  type TitleTurn,
} from "@/lib/title-generator";

export const dynamic = "force-dynamic";

/**
 * POST /api/sessions/[id]/auto-name
 *
 * Generate (or regenerate) a session title with an already-configured model.
 *
 * body: {
 *   mode: "first" | "regenerate",   // required
 *   provider?: string, modelId?: string,  // title model; required
 *   firstMessage?: string           // mode=first: the first user message text
 * }
 *
 * mode "first": title from just the first user message.
 * mode "regenerate": title from the last two user+assistant rounds in the
 * session file (tool calls/thinking stripped).
 *
 * The generated title is persisted via `SessionManager.appendSessionInfo`
 * (same path as manual rename) and the session list cache is invalidated.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: {
    mode?: unknown;
    provider?: unknown;
    modelId?: unknown;
    firstMessage?: unknown;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode;
  if (mode !== "first" && mode !== "regenerate") {
    return NextResponse.json({ error: "mode must be 'first' or 'regenerate'" }, { status: 400 });
  }
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  if (!provider || !modelId) {
    return NextResponse.json({ error: "provider and modelId are required" }, { status: 400 });
  }

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    let turns: TitleTurn[];
    if (mode === "first") {
      const firstMessage = typeof body.firstMessage === "string" ? body.firstMessage.trim() : "";
      if (!firstMessage) {
        return NextResponse.json({ error: "firstMessage is required for mode 'first'" }, { status: 400 });
      }
      turns = [{ role: "user", text: firstMessage }];
    } else {
      const sm = SessionManager.open(filePath);
      const entries = sm.getEntries() as never;
      const leafId = sm.getLeafId();
      const context = buildSessionContext(entries, leafId);
      turns = extractRecentTurns(context.messages, 2);
      if (turns.length === 0) {
        return NextResponse.json({ error: "The session has no user messages to name" }, { status: 400 });
      }
    }

    const result = await generateSessionTitle({ provider, modelId, turns });

    // Persist like a manual rename; append-only, safe while a session runs.
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(result.title);
    invalidateSessionListCache();

    return NextResponse.json({ title: result.title, usage: result.usage ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
