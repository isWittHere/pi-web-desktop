import { NextResponse } from "next/server";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { allowFileRoot } from "@/lib/file-access";
import { invalidateSessionListCache } from "@/lib/session-reader";
import { startRpcSession } from "@/lib/rpc-manager";

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)) {
    return value as ThinkingLevel;
  }
  throw new Error(`Invalid thinking level: ${String(value)}`);
}

// POST /api/agent/new body: { cwd, type, modelId?, provider?, thinkingLevel? }
// Session startup receives the selected model and SDK-native scope atomically.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
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
    const { session, realSessionId } = await startRpcSession(temporaryKey, "", cwd, {
      ...(toolNames ? { toolNames } : {}),
      ...(provider && modelId ? { initialModel: { provider, modelId } } : {}),
      ...(explicitThinkingLevel ? { thinkingLevel: explicitThinkingLevel } : {}),
    });

    allowFileRoot(cwd);
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
    const status = message.startsWith("Model is not available in the enabled scope")
      || message.startsWith("Invalid thinking level")
      || message.includes("must be")
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
