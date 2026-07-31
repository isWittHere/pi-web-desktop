import { NextResponse } from "next/server";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { randomUUID } from "crypto";
import { realpathSync, statSync } from "fs";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { invalidateSessionListCache } from "@/lib/session-reader";
import { startRpcSession } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)) {
    return value as ThinkingLevel;
  }
  throw new Error(`Invalid thinking level: ${String(value)}`);
}

/**
 * Resolve both the requested cwd and allowed roots before comparing them so a
 * symlink beneath an allowed root cannot redirect a new session elsewhere.
 */
export function resolveAllowedNewSessionCwd(cwd: string, allowedRoots: Set<string>): string | null {
  try {
    const realCwd = realpathSync(cwd);
    if (!statSync(realCwd).isDirectory()) return null;

    const realAllowedRoots = new Set<string>();
    for (const root of allowedRoots) {
      try {
        const realRoot = realpathSync(root);
        if (statSync(realRoot).isDirectory()) realAllowedRoots.add(realRoot);
      } catch {
        // Stale roots are not authorization grants.
      }
    }

    return isFilePathAllowed(realCwd, realAllowedRoots) ? realCwd : null;
  } catch {
    return null;
  }
}

// POST /api/agent/new body: { cwd, type, modelId?, provider?, thinkingLevel? }
// Session startup receives the selected model and SDK-native scope atomically.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as unknown;
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    const { cwd, ...command } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    const legalCwd = resolveAllowedNewSessionCwd(cwd, allowedRoots);
    if (!legalCwd) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as {
      provider?: string;
      modelId?: string;
      toolNames?: string[];
      thinkingLevel?: unknown;
      [key: string]: unknown;
    };
    if ((provider && !modelId) || (!provider && modelId)) {
      throw new Error("provider and modelId must be provided together");
    }
    if (provider !== undefined && typeof provider !== "string") {
      throw new Error("provider must be a string");
    }
    if (modelId !== undefined && typeof modelId !== "string") {
      throw new Error("modelId must be a string");
    }
    if (toolNames !== undefined && (!Array.isArray(toolNames) || toolNames.some((name) => typeof name !== "string"))) {
      throw new Error("toolNames must be an array of strings");
    }
    const explicitThinkingLevel = parseThinkingLevel(thinkingLevel);

    // startRpcSession coalesces matching in-flight keys. A UUID prevents two
    // new requests in the same millisecond from accidentally sharing a session.
    const temporaryKey = `__new__${randomUUID()}`;
    const { session, realSessionId } = await startRpcSession(temporaryKey, "", legalCwd, {
      ...(toolNames ? { toolNames } : {}),
      ...(provider && modelId ? { initialModel: { provider, modelId } } : {}),
      ...(explicitThinkingLevel ? { thinkingLevel: explicitThinkingLevel } : {}),
    });

    invalidateSessionListCache();

    const state = await session.send({ type: "get_state" }) as {
      model?: { id: string; provider: string };
      thinkingLevel?: string;
    };
    const response = {
      success: true,
      sessionId: realSessionId,
      model: state.model ? { provider: state.model.provider, modelId: state.model.id } : null,
      thinkingLevel: state.thinkingLevel,
    };

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({ ...response, data: null });
    }

    return NextResponse.json({
      ...response,
      data: await session.send(promptCommand),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof SyntaxError
      || message.startsWith("Model is not available in the enabled scope")
      || message.startsWith("Invalid thinking level")
      || message.includes("must be")
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
