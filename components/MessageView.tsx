"use client";

import { memo, useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { MarkdownBody } from "./MarkdownBody";
import { copyText } from "@/lib/clipboard";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { isImagePath } from "@/lib/file-types";

import { isEmptyThinkingBlock } from "@/lib/message-display";
import { parseSkillBlock } from "@/lib/skill-block";
import { useFileIndex, useSkillInfo } from "@/hooks/useProjectContext";
import type { MentionValidators } from "@/lib/mention-tokens";
import { CompactionSummary } from "./CompactionSummary";
import { parseUnifiedPatch, type SplitDiffCell } from "@/lib/patch";
import { ArrowBendDownRightIcon } from "@phosphor-icons/react/ArrowBendDownRight";
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { CloudArrowDownIcon } from "@phosphor-icons/react/CloudArrowDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DatabaseIcon } from "@phosphor-icons/react/Database";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { GitForkIcon } from "@phosphor-icons/react/GitFork";
import { useI18n } from "@/hooks/useI18n";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  BashExecutionMessage,
  ToolResultMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
} from "@/lib/types";

const MAX_THINKING_CACHE_ENTRIES = 100;
// Keep in sync with .chat-user-skill-tip { max-width } in globals.css — used
// to clamp the floating skill tooltip inside the window.
const SKILL_TIP_MAX_WIDTH = 340;
const thinkingContentCache = new Map<string, Promise<string>>();

/**
 * Replace the first text block of a user message (preserving image blocks).
 * Used when re-editing a historical message as its compact command form, so
 * the composer receives `/skill:name args` instead of the raw skill envelope.
 */
export function replaceUserMessageText(message: UserMessage, text: string): UserMessage {
  if (typeof message.content === "string") return { ...message, content: text };

  const content: Array<TextContent | ImageContent> = [];
  let replaced = false;
  for (const block of message.content) {
    if (block.type !== "text") {
      content.push(block);
      continue;
    }
    if (!replaced) {
      content.push({ ...block, text });
      replaced = true;
    }
  }
  if (!replaced) content.unshift({ type: "text", text });
  return { ...message, content };
}

function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}`;
  const cached = thinkingContentCache.get(key);
  if (cached) {
    thinkingContentCache.delete(key);
    thinkingContentCache.set(key, cached);
    return cached;
  }

  const request = fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
  ).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { thinking?: unknown };
    if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
    return data.thinking;
  }).catch((error) => {
    thinkingContentCache.delete(key);
    throw error;
  });

  thinkingContentCache.set(key, request);
  if (thinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
    const oldestKey = thinkingContentCache.keys().next().value;
    if (oldestKey) thinkingContentCache.delete(oldestKey);
  }
  return request;
}

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (message: UserMessage) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Map<string, ToolResultMessage> | undefined,
  next: Map<string, ToolResultMessage> | undefined,
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of (message as AssistantMessage).content ?? []) {
    if (block.type === "toolCall" && previous?.get(block.toolCallId) !== next?.get(block.toolCallId)) {
      return false;
    }
  }
  return true;
}

export const MessageView = memo(function MessageView({ message, isStreaming, toolResults, modelNames, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp, sessionId }: Props) {
  if (message.role === "user") {
    return <UserMessageView message={message as UserMessage} cwd={cwd} onOpenFile={onOpenFile} entryId={entryId} onFork={onFork} forking={forking} onNavigate={onNavigate} prevAssistantEntryId={prevAssistantEntryId} onEditContent={onEditContent} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} cwd={cwd} onOpenFile={onOpenFile} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} sessionId={sessionId} entryId={entryId} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    if ((message as CustomMessage).customType === "compaction") {
      return <CompactionSummary content={(message as CustomMessage).content} />;
    }
    return <CustomMessageView message={message as CustomMessage} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (message.role === "bashExecution") {
    return <BashExecutionView message={message as BashExecutionMessage} sessionId={sessionId} />;
  }
  return null;
}, (prev, next) => {
  return prev.message === next.message
    && prev.isStreaming === next.isStreaming
    && haveSameRelevantToolResults(prev.message, prev.toolResults, next.toolResults)
    && prev.modelNames === next.modelNames
    && prev.cwd === next.cwd
    && prev.onOpenFile === next.onOpenFile
    && prev.entryId === next.entryId
    && prev.onFork === next.onFork
    && prev.forking === next.forking
    && prev.onNavigate === next.onNavigate
    && prev.prevAssistantEntryId === next.prevAssistantEntryId
    && prev.onEditContent === next.onEditContent
    && prev.showTimestamp === next.showTimestamp
    && prev.prevTimestamp === next.prevTimestamp
    && prev.sessionId === next.sessionId;
});

function UserMessageView({ message, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent }: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (message: UserMessage) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  // The skill tooltip is portaled to document.body and positioned fixed, so
  // no chat container (the bubble's overflow, or .chat-user-message's
  // content-visibility containment) can clip it. Scrolling or resizing
  // dismisses it — the standard tooltip interaction — so it can never get
  // stuck at a stale position while the message it anchors scrolls away.
  const [skillTip, setSkillTip] = useState<{ left: number; top: number } | null>(null);
  const skillTokenRef = useRef<HTMLSpanElement | null>(null);
  const skillTipHideTimerRef = useRef<number | null>(null);

  const cancelSkillTipHide = useCallback(() => {
    if (skillTipHideTimerRef.current !== null) {
      window.clearTimeout(skillTipHideTimerRef.current);
      skillTipHideTimerRef.current = null;
    }
  }, []);
  const showSkillTip = useCallback(() => {
    cancelSkillTipHide();
    const token = skillTokenRef.current;
    if (!token) return;
    const rect = token.getBoundingClientRect();
    // Viewport-fixed coordinates. Right-align to the token's right edge
    // (tooltip grows leftward), clamped so it never leaves the window.
    const left = Math.min(
      Math.max(rect.right - SKILL_TIP_MAX_WIDTH, 8),
      window.innerWidth - SKILL_TIP_MAX_WIDTH - 8,
    );
    setSkillTip({ left, top: rect.bottom + 8 });
  }, [cancelSkillTipHide]);
  const hideSkillTip = useCallback(() => {
    if (skillTipHideTimerRef.current !== null) window.clearTimeout(skillTipHideTimerRef.current);
    // Small grace so the mouse can travel from the token into the floating
    // tooltip without it blinking away.
    skillTipHideTimerRef.current = window.setTimeout(() => setSkillTip(null), 150);
  }, []);
  useEffect(() => {
    if (skillTip === null) return;
    // Dismiss on any scroll/resize: the anchored token moves under the
    // mouse (or leaves the viewport), so a floating tooltip must not linger
    // at a stale spot. Capture catches scrolling inside any container.
    const dismiss = () => setSkillTip(null);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [skillTip]);

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  // The SDK expands /skill:name into a <skill> block before storing the
  // message; render that as a styled token instead of dumping the raw skill
  // source into the bubble. Hovering the token reveals the skill's file path
  // and description.
  const skillBlock = content ? parseSkillBlock(content) : null;

  // Validity lookups for @file mentions (project index) and /skill: tokens
  // (loaded skills). null until data arrives — mentions stay plain then.
  const fileIndex = useFileIndex(cwd);
  const skillInfo = useSkillInfo(cwd);
  const mentionValidators = useMemo<MentionValidators>(() => ({
    fileExists: (path) => {
      if (!fileIndex) return undefined;
      const key = path.toLowerCase();
      return fileIndex.paths.has(key) || fileIndex.dirs.has(key);
    },
    isSkill: (name) => (skillInfo ? skillInfo.has(name) : undefined),
  }), [fileIndex, skillInfo]);
  const markdownMentionProps = { cwd, onOpenFile, highlightMentions: true, mentionValidators } as const;
  const skillMeta = skillBlock ? skillInfo?.get(skillBlock.name) : null;

  // Editing a skill-expanded message restores the compact `/skill:name args`
  // command rather than the raw `<skill>` envelope stored by the SDK.
  const editTarget = skillBlock
    ? replaceUserMessageText(message, `/skill:${skillBlock.name}${skillBlock.args ? ` ${skillBlock.args}` : ""}`)
    : message;

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;

  const copyContent = () => {
    copyText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="chat-user-message"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="chat-user-bubble-wrap">
        <div className="chat-user-bubble">
          {imageBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
              {imageBlocks.map((img, i) => {
                // lib/types.ts ImageContent uses {source:{type,data,media_type,url}}
                // pi-ai on-disk format uses flat {data, mimeType} — handle both
                const flat = img as unknown as { data?: string; mimeType?: string };
                const src = img.source
                  ? img.source.type === "base64"
                    ? `data:${img.source.media_type};base64,${img.source.data}`
                    : img.source.url ?? ""
                  : flat.data
                    ? `data:${flat.mimeType};base64,${flat.data}`
                    : "";
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt=""
                    style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, objectFit: "contain", display: "block", border: "1px solid rgba(59,130,246,0.15)" }}
                  />
                );
              })}
            </div>
          )}
          {content && (skillBlock ? (
            <div className="chat-user-skill">
              <span
                ref={skillTokenRef}
                className="mention-token mention-token-skill"
                onMouseEnter={showSkillTip}
                onMouseLeave={hideSkillTip}
              >
                /skill:{skillBlock.name}
              </span>
              {skillBlock.args && (
                <MarkdownBody className="markdown-user-message" {...markdownMentionProps}>{skillBlock.args}</MarkdownBody>
              )}
            </div>
          ) : (
            <MarkdownBody className="markdown-user-message" {...markdownMentionProps}>{content}</MarkdownBody>
          ))}
        </div>

      </div>

      {/* Floating skill tooltip — portaled to body + fixed, so no chat
          container (bubble overflow / content-visibility containment) can
          clip it. Dismissed on scroll/resize. */}
      {skillTip !== null && (skillMeta || skillBlock?.location) && createPortal(
        <div
          className="chat-user-skill-tip"
          role="tooltip"
          style={{ left: skillTip.left, top: skillTip.top }}
          onMouseEnter={cancelSkillTipHide}
          onMouseLeave={hideSkillTip}
        >
          {skillMeta && skillMeta.description && (
            <span className="chat-user-skill-tip-desc">{skillMeta.description}</span>
          )}
          <span className="chat-user-skill-tip-path">{skillMeta?.filePath ?? skillBlock?.location}</span>
        </div>,
        document.body,
      )}

      {/* Bottom row: action buttons + timestamp */}
      {(time || canFork || canNavigate || true) && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 6, marginTop: 3,
        }}>
          <div style={{
            display: "flex", gap: 3,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 0.12s",
          }}>
            <button
              onClick={copyContent}
              title={t("desktop.copyMessage")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 22, height: 22,
                background: "none", border: "none",
                borderRadius: 5,
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? (
                <CheckIcon size={11} />
              ) : (
                <CopyIcon size={11} />
              )}
            </button>
          </div>
          {(canFork || canNavigate) && (
            <div style={{
              display: "flex", gap: 3,
              opacity: (hovered || forking) ? 1 : 0,
              pointerEvents: (hovered || forking) ? "auto" : "none",
              transition: "opacity 0.12s",
            }}>
              {canNavigate && (
                <button
                  onClick={() => { onNavigate!(prevAssistantEntryId!); onEditContent?.(editTarget); }}
                  title={t("desktop.editFromHere")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 22, height: 22,
                    background: "none", border: "none",
                    borderRadius: 5,
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <ArrowBendDownRightIcon size={11} />
                </button>
              )}
              {canFork && (
                <button
                  onClick={() => { onFork!(entryId!); }}
                  disabled={forking}
                  title={forking ? t("desktop.creatingNewSession") : t("desktop.newSessionFromHere")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 22, height: 22,
                    background: "none", border: "none",
                    borderRadius: 5,
                    color: forking ? "var(--accent)" : "var(--text-dim)",
                    cursor: forking ? "not-allowed" : "pointer",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!forking) e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { if (!forking) e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <GitForkIcon size={11} />
                </button>
              )}
            </div>
          )}
          {time && <span style={{ fontSize: 11, color: hovered ? "var(--text-muted)" : "var(--text-dim)", opacity: hovered ? 1 : 0.5, transition: "color 0.15s, opacity 0.15s" }}>{time}</span>}
        </div>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  cwd,
  onOpenFile,
  showTimestamp,
  prevTimestamp,
  sessionId,
  entryId,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  entryId?: string;
}) {
  const { t } = useI18n();
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blockItems = (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming }));
  const blocks = blockItems.map(({ block }) => block);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  // assistant message timestamp = when generation ended = when tools started running
  // toolResult timestamp = when tool execution finished
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const copyContent = () => {
    copyText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const bs = items.map(({ block }) => block);
      const now = Date.now();

      // Record start time for each block the first time we see it
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex)) blockStartTimesRef.current.set(originalIndex, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (!next.has(originalIndex) && blockStartTimesRef.current.has(originalIndex)) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart = blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      let chars = 0;
      for (const b of bs) {
        if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
        else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
        else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
      }
      if (chars === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(chars / 4 / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  const fmtToken = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  };

  const failureMessage = message.stopReason === "error" && message.errorMessage
    ? message.errorMessage
    : null;
  if (blocks.length === 0 && !isStreaming && !failureMessage) return null;

  return (
    <div
      className={["chat-assistant-message", isStreaming ? "is-streaming" : ""].filter(Boolean).join(" ")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isStreaming && (
      <div className="chat-assistant-meta">
        {(() => {
          let chars = 0;
          for (const b of blocks) {
            if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
            else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
            else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
          }
          const est = Math.round(chars / 4);
          return (
            <>

              {est > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text)" }} title={t("desktop.estimatedStreamingTokenCount")}>
                  <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 400 }}>
                    <CloudArrowDownIcon size={13} />
                    {est}
                  </span>
                  {tps !== null && (() => {
                    const speedVar = tps >= 50 ? "--accent-green" : tps >= 30 ? "--accent-blue" : tps >= 15 ? "--accent-orange" : "--accent-red";
                    return (
                      <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: `var(${speedVar})`, color: "var(--bg)", fontSize: 11, fontWeight: 400 }}>
                        {t("desktop.tokensPerSecond", { count: tps.toFixed(1) })}
                      </span>
                    );
                  })()}
                </span>
              )}
            </>
          );
        })()}
      </div>
      )}

      <div className="chat-assistant-content">
        {failureMessage && (
          <div className="chat-assistant-error" role="alert">
            <WarningCircleIcon size={13} weight="bold" />
            <span>{failureMessage}</span>
          </div>
        )}
        {blockItems.map(({ block, originalIndex }) => (
          <BlockView key={`${entryId ?? "stream"}-${originalIndex}`} block={block} toolResults={toolResults} isStreaming={isStreaming} streamingDuration={streamingDurations.get(originalIndex) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)} toolCallDurations={toolCallDurations} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} entryId={entryId} blockIndex={originalIndex} />
        ))}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginTop: 4,
      }}>
        {!isStreaming && (message.provider || message.usage) && (
          <div style={{ fontSize: 11, color: hovered ? "var(--text-muted)" : "var(--text-dim)", opacity: hovered ? 1 : 0.5, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", transition: "color 0.15s, opacity 0.15s" }}>
            {message.provider && (
              <span>{modelNames?.[`${message.provider}:${message.model}`] ?? modelNames?.[message.model] ?? message.model}</span>
            )}
            {message.usage && message.usage.input > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <ArrowUpIcon size={10} />
                {fmtToken(message.usage.input)}
              </span>
            )}
            {message.usage && message.usage.output > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <ArrowDownIcon size={10} />
                {fmtToken(message.usage.output)}
              </span>
            )}
            {message.usage && message.usage.cacheRead > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <DatabaseIcon size={10} />
                {fmtToken(message.usage.cacheRead)}
              </span>
            )}
            {message.usage && message.usage.cost?.total > 0 && (
              <span>${message.usage.cost.total.toFixed(4)}</span>
            )}
          </div>
        )}
        {textContent && !isStreaming && (
          <button
            onClick={copyContent}
            title={t("desktop.copyMessage")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22,
              background: "none", border: "none",
              borderRadius: 5,
              color: copied ? "var(--accent)" : "var(--text-dim)",
              cursor: "pointer",
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              transition: "opacity 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
          </button>
        )}
        {time && !isStreaming && (
          <span style={{ fontSize: 11, color: hovered ? "var(--text-muted)" : "var(--text-dim)", opacity: hovered ? 1 : 0.5, marginLeft: "auto", transition: "color 0.15s, opacity 0.15s" }}>{time}</span>
        )}
      </div>
    </div>
  );
}

function BlockView({ block, toolResults, isStreaming, streamingDuration, toolCallDurations, cwd, onOpenFile, sessionId, entryId, blockIndex }: { block: AssistantContentBlock; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; streamingDuration?: number; toolCallDurations?: Map<string, number>; cwd?: string; onOpenFile?: (filePath: string) => void; sessionId?: string; entryId?: string; blockIndex: number }) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} sessionId={sessionId} entryId={entryId} blockIndex={blockIndex} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    return <ToolCallBlock block={tc} result={result} duration={duration} sessionId={sessionId} />;
  }
  return null;
}

function TextBlock({ block, isStreaming, cwd, onOpenFile, sessionId }: { block: TextContent; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string) => void; sessionId?: string }) {
  return <MarkdownBody isStreaming={isStreaming} cwd={cwd} sourceSessionId={sessionId} onOpenFile={onOpenFile}>{block.text}</MarkdownBody>;
}

export function ThinkingBlock({ block, duration, sessionId, entryId, blockIndex, contentOnly = false, isStreaming, cwd, onOpenFile, className }: {
  block: ThinkingContent;
  duration?: number;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
  contentOnly?: boolean;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded || !block.deferred || content !== null) return;
    if (!sessionId || !entryId) {
      setError(t("desktop.thinkingContentUnavailable"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setContent(await loadThinkingContent(sessionId, entryId, blockIndex));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (contentOnly) {
    return (
      <ThinkingContentBody
        block={block}
        sessionId={sessionId}
        entryId={entryId}
        blockIndex={blockIndex}
        isStreaming={isStreaming}
        cwd={cwd}
        onOpenFile={onOpenFile}
        className={className}
      />
    );
  }

  return (
    <div className="thinking-block">
      <button
        onClick={() => void toggle()}
        className="thinking-block-trigger"
        aria-expanded={expanded}
      >
        <span className={`thinking-block-caret ${expanded ? "is-expanded" : ""}`} aria-hidden="true">›</span>
        <span className="thinking-block-icon" aria-hidden="true">✦</span>
        <span>{t("desktop.thinking")}</span>
        {duration !== undefined && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
      </button>
      {expanded && (
        <div className={`thinking-block-content ${error ? "is-error" : ""}`}>
          {loading ? t("desktop.loadingThinking") : error ?? (block.deferred ? content : block.thinking)}
        </div>
      )}
    </div>
  );
}

function ThinkingContentBody({ block, sessionId, entryId, blockIndex, isStreaming, cwd, onOpenFile, className }: {
  block: ThinkingContent;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(block.deferred === true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!block.deferred) {
      setLoading(false);
      return;
    }
    if (!sessionId || !entryId) {
      setLoading(false);
      setError(t("desktop.thinkingContentUnavailable"));
      return;
    }
    setLoading(true);
    setError(null);
    void loadThinkingContent(sessionId, entryId, blockIndex)
      .then((value) => { if (!cancelled) setContent(value); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [block.deferred, blockIndex, entryId, sessionId, t]);

  if (loading) return <div className="text-xs text-text-dim">{t("desktop.loadingThinking")}</div>;
  if (error) return <div className="text-xs text-red-400">{error}</div>;

  return (
    <MarkdownBody isStreaming={isStreaming} cwd={cwd} sourceSessionId={sessionId} onOpenFile={onOpenFile} className={className}>
      {block.deferred ? (content ?? "") : block.thinking}
    </MarkdownBody>
  );
}

// Large tool outputs are rendered as plain text; cap the initial render and
// let the user opt into the full payload so expanding a 45K result stays snappy.
const RESULT_PREVIEW_CHARS = 8000;

export const ToolCallBlock = memo(function ToolCallBlock({ block, result, duration, processStyle = false, sessionId }: { block: ToolCallContent; result?: ToolResultMessage; duration?: number; processStyle?: boolean; sessionId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = useMemo(() => JSON.stringify(block.input, null, 2), [block.input]);
  const isEditTool = isEditToolName(block.toolName);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;

  // Result display
  const resultText = useMemo(
    () => (result
      ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
      : null),
    [result],
  );
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const isError = result?.isError ?? false;
  const imageSources = useMemo(
    () => getToolResultImageSources(block.input, result, sessionId),
    [block.input, result, sessionId],
  );

  return (
    <div
      className={`tool-call-block ${processStyle ? "is-process" : ""} ${isError ? "is-error" : ""}`}
    >
      {/* ── Tool call header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="tool-call-trigger"
        aria-expanded={expanded}
      >
        <span className="tool-call-name">
          {block.toolName}
        </span>
        <span className="tool-call-preview">
          {getToolPreview(block)}
        </span>
        {duration !== undefined && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
        <span className={`tool-call-caret ${expanded ? "is-expanded" : ""}`} aria-hidden="true">
          <CaretRightIcon size={12} />
        </span>
      </button>

      {/* ── Expanded: input args ── */}
      {expanded && !isEditTool && (
        <pre className="tool-call-input">
          {inputStr}
        </pre>
      )}

      {/* ── Paired result — only shown when expanded ── */}
      {expanded && result && (
        resultDiff ? (
          <PairedDiffResult
            diff={resultDiff}
            processStyle={processStyle}
          />
        ) : (
          <PairedResult
            text={resultText ?? ""}
            isEmpty={resultIsEmpty}
            isError={isError}
            processStyle={processStyle}
          />
        )
      )}
      <ToolResultImages sources={imageSources} />
    </div>
  );
});

export function getToolResultImageSources(
  input: Record<string, unknown>,
  result?: ToolResultMessage,
  sessionId?: string,
): string[] {
  const sources = result?.content
    .filter((item): item is ImageContent => item.type === "image")
    .map(imageSource)
    .filter(Boolean) ?? [];
  if (sources.length > 0) return sources;

  if (!result || result.isError || typeof input.path !== "string" || !isImagePath(input.path)) return [];
  return [`/api/files/${encodeFilePathForApi(input.path)}?type=read${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`];
}

export function ToolResultImages({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, padding: 8, borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
      {sources.map((src, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${src.slice(0, 80)}:${index}`}
          src={src}
          alt=""
          style={{ display: "block", maxWidth: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 6 }}
        />
      ))}
    </div>
  );
}

interface ResultDiff {
  text: string;
}

function PairedDiffResult({ diff, processStyle = false }: {
  diff: ResultDiff;
  processStyle?: boolean;
}) {
  return (
    <div
      style={{
        borderTop: processStyle ? "1px solid var(--border)" : "1px solid rgba(34,197,94,0.15)",
        background: "var(--bg)",
      }}
    >
      <SplitPatchView text={diff.text} />
    </div>
  );
}

function SplitPatchView({ text }: { text: string }) {
  const { t } = useI18n();
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  const showFileHeaders = files.length > 1;

  return (
    <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "hidden", background: "var(--bg)" }}>
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={{
            minWidth: 0,
            borderTop: fileIndex === 0 ? "none" : "1px solid var(--border)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {showFileHeaders && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "var(--bg-panel)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <SplitDiffHeader title={file.oldPath || t("desktop.before")} side="left" />
              <SplitDiffHeader title={file.newPath || t("desktop.after")} side="right" />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") {
                return null;
              }

              return (
                <div key={rowIndex} style={{ display: "contents" }}>
                  <SplitDiffCellView cell={row.left} side="left" />
                  <SplitDiffCellView cell={row.right} side="right" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      style={{
        padding: "5px 10px",
        color: "var(--text-dim)",
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  );
}

function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const bg =
    cell.type === "added"
      ? "rgba(34,197,94,0.12)"
      : cell.type === "removed"
      ? "rgba(248,113,113,0.13)"
      : cell.type === "empty"
      ? "var(--bg-subtle)"
      : "transparent";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added" ? "#22c55e" : cell.type === "removed" ? "#f87171" : "var(--text-dim)";

  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        background: bg,
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
      }}
    >
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--text-dim)",
          userSelect: "none",
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        style={{
          width: 18,
          padding: "0 5px",
          color: markerColor,
          userSelect: "none",
          fontWeight: cell.type === "context" || cell.type === "empty" ? 400 : 700,
          flexShrink: 0,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 10px 0 0",
          color: cell.type === "empty" ? "var(--text-dim)" : "var(--text)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}

function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div style={{ maxHeight: 520, overflowY: "auto", overflowX: "hidden", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55, minWidth: 0 }}>
      {lines.map((line, i) => {
        const kind =
          line.startsWith("@@") ? "hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "added" :
          line.startsWith("-") && !line.startsWith("---") ? "removed" :
          "context";
        const bg =
          kind === "added" ? "rgba(34,197,94,0.12)" :
          kind === "removed" ? "rgba(248,113,113,0.13)" :
          kind === "hunk" ? "rgba(96,165,250,0.12)" :
          "transparent";
        const color =
          kind === "added" ? "#22c55e" :
          kind === "removed" ? "#f87171" :
          kind === "hunk" ? "var(--accent)" :
          "var(--text)";

        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: bg,
              borderLeft: kind === "added"
                ? "3px solid #22c55e"
                : kind === "removed"
                ? "3px solid #f87171"
                : kind === "hunk"
                ? "3px solid var(--accent)"
                : "3px solid transparent",
            }}
          >
            <span
              style={{
                width: 48,
                padding: "0 8px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                borderRight: "1px solid var(--border)",
                textAlign: "right",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ padding: "0 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color }}>
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

  return null;
}

function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return name === "edit" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.includes("str_replace") ||
    name.includes("replace_editor");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function PairedResult({ text, isEmpty, isError, processStyle = false }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
  processStyle?: boolean;
}) {
  const { t } = useI18n();
  const [showFull, setShowFull] = useState(false);
  const border = processStyle ? "var(--border)" : isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)";
  const truncated = !isEmpty && text.length > RESULT_PREVIEW_CHARS && !showFull;
  const displayText = truncated ? text.slice(0, RESULT_PREVIEW_CHARS) : text;
  return (
    <div
      style={{
        borderTop: `1px solid ${border}`,
        background: processStyle ? "var(--bg-subtle)" : isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          color: isError ? "#f87171" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
          fontSize: 12,
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: 400,
          background: "var(--bg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty ? t("desktop.noOutput") : displayText}
      </pre>
      {truncated && (
        <button
          onClick={() => setShowFull(true)}
          style={{
            display: "block",
            margin: "6px 8px 8px",
            padding: "4px 10px",
            border: "1px solid var(--border)",
            borderRadius: 5,
            background: "transparent",
            color: "var(--text-dim)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {t("desktop.loadFullOutput")}
        </button>
      )}
    </div>
  );
}



function CustomMessageView({ message, isStreaming, cwd, onOpenFile }: { message: CustomMessage; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string) => void }) {
  const { t } = useI18n();
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = formatCustomType(message.customType, t("desktop.extension"));
  const time = formatTime(message.timestamp);

  const copyContent = () => {
    copyText(text || detailsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: isHiddenDisplay ? "var(--bg-subtle)" : "var(--bg)",
          opacity: isHiddenDisplay && !contentExpanded ? 0.82 : 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 650 }}>
            {title}
          </span>
          {isHiddenDisplay && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("desktop.hiddenExtensionMessage")}</span>}
          {time && <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>{time}</span>}
        </div>

        {contentExpanded ? (
          <div style={{ padding: "6px 9px" }}>
            {images.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: text ? 8 : 0 }}>
                {images.map((img, i) => {
                  const src = imageSource(img);
                  if (!src) return null;
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt=""
                      style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, objectFit: "contain", display: "block", border: "1px solid var(--border)" }}
                    />
                  );
                })}
              </div>
            )}
            {text ? <MarkdownBody className="markdown-custom-message" isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody> : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("desktop.noMessage")}</span>}
          </div>
        ) : (
          <button
            onClick={() => setContentExpanded(true)}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
            }}
          >
            {text ? previewText(text, t("desktop.showExtensionMessage")) : t("desktop.showExtensionMessage")}
          </button>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 9px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-subtle)",
          }}
        >
          {text || detailsText ? (
            <button
              onClick={copyContent}
              style={{
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {copied ? t("desktop.copied") : t("desktop.copy")}
            </button>
          ) : null}
          {(hasDetails || isHiddenDisplay) && (
            <button
              onClick={() => {
                if (isHiddenDisplay) setContentExpanded((v) => !v);
                else setDetailsExpanded((v) => !v);
              }}
              style={{
                marginLeft: "auto",
                padding: "3px 7px",
                border: "none",
                background: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              {isHiddenDisplay
                ? (contentExpanded ? t("desktop.collapse") : t("desktop.expand"))
                : (detailsExpanded ? t("desktop.hideDetails") : t("desktop.showDetails"))}
            </button>
          )}
        </div>

        {hasDetails && ((isHiddenDisplay && contentExpanded) || (!isHiddenDisplay && detailsExpanded)) && (
          <pre
            style={{
              margin: 0,
              padding: "9px 10px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 360,
              overflow: "auto",
              fontFamily: "var(--font-mono)",
            }}
          >
            {detailsText}
          </pre>
        )}
      </div>
    </div>
  );
}

function BashExecutionView({ message, sessionId }: { message: BashExecutionMessage; sessionId?: string }) {
  const { t } = useI18n();
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);
  const isPending = !message.output && message.exitCode === undefined && !message.cancelled;
  const isError = message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0);
  const fullOutputUrl = sessionId && message.fullOutputPath
    ? `/api/agent/${encodeURIComponent(sessionId)}/bash-output?path=${encodeURIComponent(message.fullOutputPath)}`
    : null;
  const displayOutput = fullOutput ?? message.output;

  const loadFullOutput = async () => {
    if (!fullOutputUrl) return;
    setLoadingFull(true);
    setFullError(null);
    try {
      const response = await fetch(fullOutputUrl);
      const data = await response.json() as { success?: boolean; data?: { output?: string }; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
      setFullOutput(data.data?.output ?? "");
    } catch (error) {
      setFullError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingFull(false);
    }
  };

  const toolName = message.excludeFromContext ? "bash (local)" : "bash";
  const block: ToolCallContent = {
    type: "toolCall",
    toolCallId: `bash-${message.timestamp ?? message.command}`,
    toolName,
    input: { command: message.command },
  };
  const result: ToolResultMessage | undefined = isPending ? undefined : {
    role: "toolResult",
    toolCallId: block.toolCallId,
    toolName,
    content: displayOutput ? [{ type: "text", text: displayOutput }] : [],
    isError,
    timestamp: message.timestamp,
  };

  return (
    <div style={{ margin: "6px 0" }}>
      <ToolCallBlock block={block} result={result} />
      {message.truncated && fullOutputUrl && fullOutput === null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => void loadFullOutput()}
            disabled={loadingFull}
            style={{ padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 4, background: "none", color: "var(--text-muted)", cursor: loadingFull ? "wait" : "pointer", fontSize: 11 }}
          >
            {loadingFull ? t("desktop.loading") : t("desktop.loadFullOutput")}
          </button>
          <a href={`${fullOutputUrl}&download=1`} style={{ fontSize: 11, color: "var(--accent)" }}>{t("desktop.download")}</a>
        </div>
      )}
      {fullError && <div style={{ marginTop: 4, color: "var(--accent-red)", fontSize: 11 }}>{fullError}</div>}
    </div>
  );
}

function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    if (img.source.type === "base64") {
      return img.source.data ? `data:${img.source.media_type ?? "image/png"};base64,${img.source.data}` : "";
    }
    return img.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCustomType(type: string, fallback: string): string {
  return type || fallback;
}

function previewText(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}


function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}
