import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeSimple, type Message } from "@earendil-works/pi-ai/compat";

/**
 * Session title generation.
 *
 * Standalone "widget" feature: generates a short session title from recent
 * conversation turns using an already-configured model. It does not create an
 * AgentSession and does not touch pi SDK internals — only the public
 * `ModelRuntime` + `completeSimple` surface (same pattern as
 * /api/models-config/test). Because it runs a single-shot completion with no
 * tools, a naming run can never mutate the project.
 */

const TITLE_TIMEOUT_MS = 30_000;
const TITLE_MAX_TOKENS = 128;
const MAX_TITLE_LENGTH = 60;
const MAX_ROUNDS = 2;

export const TITLE_PROMPT = `Create a concise title for this coding-agent chat session based on the conversation above.

Requirements:
- Match the primary language used in the conversation (中文 or English).
- Describe the user's concrete goal or the work done, not the act of chatting.
- Use 4-12 words for space-separated languages, or 8-24 characters for CJK text.
- Do not call any tools.
- Return only the title as plain text: no quotes, labels, markdown, or explanation.`;

/** A normalized turn used as LLM input for title generation. */
export interface TitleTurn {
  role: "user" | "assistant";
  /** Plain text content (tool calls, thinking, and images stripped). */
  text: string;
}

/** Text blocks inside a session message (user/assistant/toolResult content). */
interface BlockLike {
  type?: string;
  text?: unknown;
  thinking?: unknown;
  data?: unknown;
  source?: { type?: string; data?: unknown };
}

function blockText(block: BlockLike): string | undefined {
  if (block.type !== "text") return undefined;
  return typeof block.text === "string" ? block.text : undefined;
}

function messageText(message: {
  role?: string;
  content?: string | BlockLike[] | null;
}): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const text = blockText(block);
    if (text) parts.push(text);
  }
  return parts.join("\n").trim();
}

/**
 * Extract the last `maxRounds` user+assistant turns from a conversation for
 * title generation.
 *
 * Rules:
 * - Tool results are skipped; assistant content keeps only text blocks
 *   (toolCall/thinking/image blocks are stripped).
 * - A user message always starts a new turn. Assistant text following it is
 *   attached to that turn (multi-assistant runs are merged into one turn).
 * - If the conversation ends with a user message that has no reply yet, the
 *   trailing turn is still included (it may be the message being answered).
 * - Returns at most `maxRounds` complete-or-partial turns, oldest first.
 */
export function extractRecentTurns(
  messages: Array<{ role?: string; content?: string | BlockLike[] | null }>,
  maxRounds = MAX_ROUNDS,
): TitleTurn[] {
  const turns: TitleTurn[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = messageText(message);
      if (!text) continue;
      turns.push({ role: "user", text });
    } else if (message.role === "assistant" && turns.length > 0) {
      const text = messageText(message);
      if (!text) continue;
      const last = turns[turns.length - 1];
      // Merge assistant text into the current turn: either as the first
      // assistant reply, or appended when a previous assistant turn already
      // exists (a run that returned multiple assistant messages).
      if (last.role === "user") {
        turns.push({ role: "assistant", text });
      } else {
        last.text = `${last.text}\n\n${text}`.trim();
      }
    }
    // toolResult messages are deliberately ignored.
  }

  const sliced = turns.slice(-maxRounds * 2);
  // Strip a leading assistant turn when the slice boundary lands on one
  // (the visible round should start with the user message it answers).
  if (sliced.length > 0 && sliced[0].role === "assistant") sliced.shift();
  return sliced;
}

/**
 * Strip wrapper punctuation/labels from a raw model reply so it can be used
 * verbatim as a session title.
 */
export function parseGeneratedSessionTitle(raw: string): string {
  let value = raw.trim();
  const fenced = value.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { title?: unknown };
      if (typeof parsed.title === "string") value = parsed.title.trim();
    } catch {
      // Fall through to plain-text cleanup below.
    }
  }

  value = value.split(/\r?\n/, 1)[0] ?? "";
  value = value.replace(/^(?:session\s+title|title|标题)\s*[:：-]\s*/i, "");
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u300e", "\u300f"],
  ];
  for (const [start, end] of quotePairs) {
    if (value.startsWith(start) && value.endsWith(end) && value.length > start.length + end.length) {
      value = value.slice(start.length, -end.length).trim();
      break;
    }
  }
  value = value.replace(/\s+/g, " ").trim();
  value = value.replace(/[。.!]+$/u, "").trim();

  if (!/[\p{L}\p{N}]/u.test(value)) {
    throw new Error("The model did not return a usable session title");
  }

  const characters = Array.from(value);
  if (characters.length > MAX_TITLE_LENGTH) {
    value = characters.slice(0, MAX_TITLE_LENGTH).join("").trim();
  }
  return value;
}

export interface GenerateTitleOptions {
  provider: string;
  modelId: string;
  /** Normalized conversation turns (see `extractRecentTurns`). */
  turns: TitleTurn[];
  signal?: AbortSignal;
}

export interface GeneratedTitle {
  title: string;
  /** Token usage reported by the completion, when available. */
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Generate a session title with an already-configured model.
 *
 * Resolves the model + auth from the user's real `~/.pi/agent/models.json`
 * and `auth.json`, then runs a single-shot, tool-less completion. The title
 * instruction is folded into the trailing user message (or appended as a new
 * user message) rather than sent as the system prompt: some models treat an
 * unanswered trailing user message as an active request, and the title
 * instruction appended after it keeps the run focused on naming, not
 * answering.
 */
export async function generateSessionTitle(options: GenerateTitleOptions): Promise<GeneratedTitle> {
  const { provider, modelId, turns, signal } = options;
  const turnsForPrompt = turns.length > 0 ? turns : [{ role: "user" as const, text: "New session" }];

  // Defaults to getAgentDir()/models.json + auth.json, exactly like the model
  // config UI and the /api/models-config/test route.
  const runtime = await ModelRuntime.create();
  const loadError = runtime.getError();
  if (loadError) throw new Error(loadError);

  const model = runtime.getModel(provider, modelId);
  if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
  const resolved = await runtime.getAuth(model);
  // API-key providers pass `apiKey`; OAuth/proxied providers may pass only
  // headers (e.g. an Authorization bearer). Require at least one credential.
  if (!resolved?.auth.apiKey && !resolved?.auth.headers) {
    throw new Error(`No API key found for "${provider}"`);
  }

  const turnsWithPrompt = [...turnsForPrompt];
  const last = turnsWithPrompt[turnsWithPrompt.length - 1];
  if (last && last.role === "user") {
    // Fold the title request into the trailing user message so the provider
    // does not receive two consecutive user messages.
    last.text = `${last.text}\n\n${TITLE_PROMPT}`;
  } else {
    turnsWithPrompt.push({ role: "user", text: TITLE_PROMPT });
  }

  // Minimal text-only messages: no tool calls/thinking/tool results, so the
  // provider adapters only need `role` + `content`. Assistant turns carry a
  // zeroed `usage` because the context estimator reads it when scanning for a
  // trailing assistant message. `transformMessages` tolerates the remaining
  // missing optional fields (cross-model checks degrade safely).
  const messages: Message[] = turnsWithPrompt.map((turn) => ({
    role: turn.role,
    content: [{ type: "text", text: turn.text }],
    ...(turn.role === "assistant" ? { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } } : {}),
    timestamp: Date.now(),
  }) as Message);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const result = await completeSimple(model, {
      messages,
    }, {
      apiKey: resolved.auth.apiKey,
      headers: resolved.auth.headers,
      maxTokens: TITLE_MAX_TOKENS,
      timeoutMs: TITLE_TIMEOUT_MS,
      maxRetries: 0,
      cacheRetention: "none",
      signal: controller.signal,
    });

    if (result.stopReason === "error" || result.stopReason === "aborted") {
      throw new Error(result.errorMessage ?? (controller.signal.aborted
        ? "Session title generation timed out"
        : "The title model request failed"));
    }

    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("The model did not return a session title");

    const usage = result.usage;
    return {
      title: parseGeneratedSessionTitle(text),
      ...(usage ? {
        usage: {
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
          total: usage.totalTokens,
        },
      } : {}),
    };
  } catch (error) {
    throw new Error(errorMessage(error));
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
