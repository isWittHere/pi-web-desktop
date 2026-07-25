import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  CustomMessage,
  ImageContent,
  ToolResultMessage,
} from "./types";

export interface BlockOrigin {
  phase: "process" | "result";
  placement: "inline" | "standalone";
  groupId?: string;
  sourceMessageIndex: number;
  sourceEntryId?: string;
  sourceBlockIndex?: number;
}

interface ProcessBlockBase {
  id: string;
  origin: BlockOrigin;
}

export type ProcessContentBlock =
  | (ProcessBlockBase & { type: "text"; text: string })
  | (ProcessBlockBase & { type: "image"; source: ImageContent["source"] })
  | (ProcessBlockBase & { type: "thinking"; thinking: string; deferred?: boolean; duration?: number })
  | (ProcessBlockBase & {
      type: "toolCall";
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
      result?: ToolResultMessage;
      duration?: number;
      status: "running" | "success" | "error";
    })
  | (ProcessBlockBase & { type: "custom"; customType: string; message: CustomMessage });

interface ConvertMessageOptions {
  messageIndex: number;
  entryId?: string;
  phase: BlockOrigin["phase"];
  toolResults?: Map<string, ToolResultMessage>;
  blocks?: AssistantContentBlock[];
  isStreaming?: boolean;
}

function displayableAssistantBlocks(message: AssistantMessage, isStreaming: boolean): AssistantContentBlock[] {
  return (message.content ?? []).filter((block) => (
    block.type !== "thinking" || block.deferred || isStreaming || block.thinking.trim().length > 0
  ));
}

function blockId(entryId: string | undefined, messageIndex: number, blockIndex: number): string {
  return `${entryId ?? `message-${messageIndex}`}:${blockIndex}`;
}

function toolDuration(message: AssistantMessage, result: ToolResultMessage | undefined): number | undefined {
  if (!message.timestamp || !result?.timestamp) return undefined;
  const seconds = Math.round((result.timestamp - message.timestamp) / 1000);
  return seconds > 0 ? seconds : undefined;
}

export function messageToProcessContentBlocks(
  message: AgentMessage,
  options: ConvertMessageOptions,
): ProcessContentBlock[] {
  const { messageIndex, entryId, phase, toolResults, isStreaming = false } = options;

  if (message.role === "custom") {
    const custom = message as CustomMessage;
    if (!custom.display) return [];
    return [{
      id: blockId(entryId, messageIndex, 0),
      type: "custom",
      customType: custom.customType,
      message: custom,
      origin: {
        phase,
        placement: "standalone",
        sourceMessageIndex: messageIndex,
        sourceEntryId: entryId,
      },
    }];
  }

  if (message.role !== "assistant") return [];
  const assistant = message as AssistantMessage;
  const selectedBlocks = options.blocks ?? displayableAssistantBlocks(assistant, isStreaming);

  return selectedBlocks.map((block, localIndex) => {
    const sourceBlockIndex = assistant.content.indexOf(block);
    const resolvedBlockIndex = sourceBlockIndex >= 0 ? sourceBlockIndex : localIndex;
    const originBase = {
      phase,
      placement: "standalone" as const,
      sourceMessageIndex: messageIndex,
      sourceEntryId: entryId,
      sourceBlockIndex: resolvedBlockIndex,
    };
    const id = blockId(entryId, messageIndex, resolvedBlockIndex);

    if (block.type === "text") {
      return { id, type: "text", text: block.text, origin: originBase };
    }
    if (block.type === "image") {
      return { id, type: "image", source: block.source, origin: originBase };
    }
    if (block.type === "thinking") {
      return {
        id,
        type: "thinking",
        thinking: block.thinking,
        deferred: block.deferred,
        origin: originBase,
      };
    }

    const result = toolResults?.get(block.toolCallId);
    return {
      id,
      type: "toolCall",
      toolCallId: block.toolCallId,
      toolName: block.toolName,
      input: block.input,
      result,
      duration: toolDuration(assistant, result),
      status: result?.isError ? "error" : result ? "success" : "running",
      origin: { ...originBase, groupId: block.toolCallId },
    };
  });
}

export function splitAssistantContentBlocks(
  message: AssistantMessage,
  options: Omit<ConvertMessageOptions, "phase" | "blocks">,
): { processBlocks: ProcessContentBlock[]; resultBlocks: ProcessContentBlock[] } {
  const blocks = displayableAssistantBlocks(message, options.isStreaming ?? false);
  const lastProcessIndex = blocks.findLastIndex((block) => block.type !== "text" && block.type !== "image");
  const processBlocks = lastProcessIndex === -1 ? [] : blocks.slice(0, lastProcessIndex + 1);
  const resultBlocks = lastProcessIndex === -1 ? blocks : blocks.slice(lastProcessIndex + 1);
  return {
    processBlocks: messageToProcessContentBlocks(message, {
      ...options,
      phase: "process",
      blocks: processBlocks,
    }),
    resultBlocks: messageToProcessContentBlocks(message, {
      ...options,
      phase: "result",
      blocks: resultBlocks,
    }),
  };
}

export function collectProcessContentBlocks(
  messages: AgentMessage[],
  entryIds: string[],
  messageIndices: number[],
  toolResults?: Map<string, ToolResultMessage>,
): ProcessContentBlock[] {
  return messageIndices.flatMap((messageIndex) => messageToProcessContentBlocks(messages[messageIndex], {
    messageIndex,
    entryId: entryIds[messageIndex],
    phase: "process",
    toolResults,
  }));
}
