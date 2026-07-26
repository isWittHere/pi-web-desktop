"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import { clearDraft, getDraft, setDraft, type ChatDraftImage } from "@/lib/draft-store";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLanguage } from "@/hooks/useLanguage";
import { ArrowBendUpLeftIcon } from "@phosphor-icons/react/ArrowBendUpLeft";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowElbowDownRightIcon } from "@phosphor-icons/react/ArrowElbowDownRight";
import { ArrowUpIcon } from "@phosphor-icons/react/ArrowUp";
import { ArrowsInIcon } from "@phosphor-icons/react/ArrowsIn";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import { LightbulbIcon } from "@phosphor-icons/react/Lightbulb";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/PaperPlaneTilt";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { SpeakerHighIcon } from "@phosphor-icons/react/SpeakerHigh";
import { SpeakerSlashIcon } from "@phosphor-icons/react/SpeakerSlash";
import { SquareIcon } from "@phosphor-icons/react/Square";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { XIcon } from "@phosphor-icons/react/X";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  onModelChange?: (provider: string, modelId: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
}

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = { off: "none", default: "default", full: "full" };
const COMPOSITION_END_ENTER_GRACE_MS = 100;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;


function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

type SlashCommandPaletteItem = SlashCommandInfo | {
  name: string;
  description: string;
  source: "builtin";
};

type SlashCommandSource = SlashCommandPaletteItem["source"];



const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];



const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

function slashMatchRank(command: SlashCommandPaletteItem, query: string): number {
  const name = command.name.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

function QueuedMessageRow({ kind, text, label }: { kind: "steer" | "follow-up"; text: string; label: string }) {
  return (
    <div
      title={text}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 10px",
        fontSize: 12,
        color: "var(--text-muted)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          padding: "1px 7px",
          borderRadius: 999,
          border: `1px solid ${kind === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
          color: kind === "steer" ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {label}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, onModelChange,
  onCompact, onAbortCompaction, isCompacting, compactError, compactResult, toolPreset, onToolPresetChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, onRecallQueue,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
}: Props, ref) {
  const isMobile = useIsMobile();
  const { t } = useLanguage();
  const thinkingLevelLabels: Record<typeof THINKING_LEVELS[number], string> = {
    auto: t("thinkingAuto"),
    off: t("thinkingOff"),
    minimal: t("thinkingMinimal"),
    low: t("thinkingLow"),
    medium: t("thinkingMedium"),
    high: t("thinkingHigh"),
    xhigh: t("thinkingExtraHigh"),
    max: t("thinkingMax"),
  };
  const toolPresetLabels: Record<typeof TOOL_PRESETS[number], string> = {
    off: t("toolOff"),
    default: t("toolDefault"),
    full: t("toolFull"),
  };
  const thinkingLevelDescriptions: Record<typeof THINKING_LEVELS[number], string> = {
    auto: t("usePiDefault"),
    off: t("reasoningOff"),
    minimal: t("minimalReasoning"),
    low: t("lowReasoning"),
    medium: t("mediumReasoning"),
    high: t("highReasoning"),
    xhigh: t("extraHighReasoning"),
    max: t("maxReasoning"),
  };
  const builtinSlashCommands: SlashCommandPaletteItem[] = [
    { name: "compact", description: t("compactCommandDescription"), source: "builtin" },
    { name: "reload", description: t("reloadCommandDescription"), source: "builtin" },
    { name: "name", description: t("nameCommandDescription"), source: "builtin" },
    { name: "session", description: t("sessionCommandDescription"), source: "builtin" },
    { name: "copy", description: t("copyCommandDescription"), source: "builtin" },
  ];
  const slashSourceGroupLabels: Record<SlashCommandSource, string> = {
    builtin: t("builtIn"),
    extension: t("extensions"),
    prompt: t("prompts"),
    skill: t("commandSkills"),
  };
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? getDraft(draftKey)?.images.map(draftImageToAttachedImage) ?? [] : []
  ));
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    if (isStreaming) return;
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<AttachedImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // result is "data:<mime>;base64,<data>"
              const base64 = result.split(",")[1];
              resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachedImages((prev) => [...prev, ...newImages]);
  }, [isStreaming]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    setValue("");
    setAtQuery(null);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
    });
  }, [attachedImages, draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    setValue(draft?.value ?? "");
    setAtQuery(null);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return draft?.images.map(draftImageToAttachedImage) ?? [];
    });
  }, [draftKey]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onAudioUnlock?.();
    if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (!result.error) clearInput();
        return;
      }
    }
    onSend(msg, attachedImages.length ? attachedImages : undefined);
    clearInput();
  }, [value, attachedImages, isStreaming, onBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const commands = [...(isStreaming ? [] : builtinSlashCommands), ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = command.description?.toLowerCase() ?? "";
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery) - slashMatchRank(b, slashQuery);
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || MODEL_OPTION_COLLATOR.compare(a.name, b.name);
      });
  })();

  const groupedSlashCommands = (() => {
    const groups = new Map<SlashCommandSource, { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }>();
    for (const source of SLASH_SOURCES) {
      groups.set(source, { source, items: [] });
    }
    filteredSlashCommands.forEach((command, index) => {
      groups.get(command.source)?.items.push({ command, index });
    });
    return SLASH_SOURCES
      .map((source) => groups.get(source)!)
      .filter((group) => group.items.length > 0);
  })();

  const slashCommandCountLabel = `${filteredSlashCommands.length} ${t(
    slashQuery
      ? (filteredSlashCommands.length === 1 ? "match" : "matches")
      : (filteredSlashCommands.length === 1 ? "command" : "commands")
  )}`;
  const hasInputText = Boolean(value.trim());
  const canQueueStreamingMessage = hasInputText && attachedImages.length === 0;

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (!cwd) {
      setAtQuery(null);
      return;
    }
    const pos = cursor ?? text.length;
    setAtQuery(extractAtQuery(text.slice(0, pos)));
  }, [cwd]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [atQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (attachedImages.length) return;
    onAudioUnlock?.();
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      onPromptWithStreamingBehavior(msg, streamingBehavior, attachedImages.length ? attachedImages : undefined);
      clearInput();
      return;
    }
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined);
    }
    clearInput();
  }, [value, attachedImages, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = filteredSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [filteredSlashCommands.length, slashActiveIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (e.key === "Enter" && !e.shiftKey && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && filteredSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(filteredSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      // Esc stops the agent when no slash/@ menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Default Enter sends as steer if available, else followup
          sendQueued(onSteer ? "steer" : "followup");
        } else {
          handleSend();
        }
      }
    },
    [isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, filteredSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    })).sort(compareModelOptions);
  })();

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of modelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const displayModelName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? `${t("compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} ${t("tokens")} (${formatTokenCount(compactSavedTokens)} ${t("saved")})`
    : null;
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return thinkingLevelLabels[lvl];
    return thinkingLevelMap[lvl] ?? thinkingLevelLabels[lvl];
  })();
  const toolPresetKey = Object.entries(TOOL_PRESET_MAP).find(([, value]) => value === (toolPreset ?? "default"))?.[0] as typeof TOOL_PRESETS[number] | undefined;
  const toolPresetLabel = toolPresetLabels[toolPresetKey ?? "default"];

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
      if (controlsMenuRef.current && !controlsMenuRef.current.contains(e.target as Node)) {
        setControlsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!isMobile) setControlsMenuOpen(false);
  }, [isMobile]);



  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 16px",
        paddingRight: isMobile ? 16 : 34, // desktop: 16px base + 18px for ChatMinimap alignment
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={isStreaming}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div style={{
            marginBottom: 8,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-panel)",
            padding: "5px 0",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 8px 4px 10px",
            }}>
              <span style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}>
                {t("queued")} · {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                  title={t("recallQueuedMessages")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    fontSize: 12,
                    color: "var(--text)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <ArrowBendUpLeftIcon size={13} />
                  {t("recallToInput")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow key={`steer-${i}`} kind="steer" label={t("steer")} text={text} />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow key={`followup-${i}`} kind="follow-up" label={t("followUp")} text={text} />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <ArrowClockwiseIcon size={11} style={{ flexShrink: 0 }} />
            {t("retrying")} ({retryInfo.attempt}/{retryInfo.maxAttempts})…{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {compactResultText && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.24)",
            borderRadius: 6, fontSize: 12, color: "rgba(5,150,105,0.95)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <CheckIcon size={11} style={{ flexShrink: 0 }} />
            {compactResultText}
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt=""
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }}
                />
                <button
                  onClick={() => removeImage(i)}
                  title={t("removeImage")}
                  aria-label={t("removeImage")}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <XIcon size={8} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div style={{ position: "relative" }}>
          {slashMenuOpen && slashQuery !== null && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                overflow: "hidden",
                maxHeight: "min(56vh, 460px)",
              }}
            >
              <div
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                <span>{slashCommandsLoading ? t("loadingCommands") : `${t("slashCommands")} · ${slashCommandCountLabel}`}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{t("tabOrEnter")}</span>
              </div>
              <div style={{ maxHeight: "calc(min(56vh, 460px) - 34px)", overflowY: "auto", padding: 10 }}>
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "2px 2px 4px", fontSize: 12, color: "var(--text-dim)" }}>
                    {t("noSlashCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          position: "sticky",
                          top: -10,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "4px 0 6px",
                          background: "var(--bg)",
                          color: "var(--text-dim)",
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        <span>{slashSourceGroupLabels[group.source]}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{group.items.length}</span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          return (
                            <button
                              key={`${command.source}:${command.name}`}
                              ref={(node) => {
                                slashItemRefs.current[index] = node;
                              }}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                              style={{
                                width: "100%",
                                minWidth: 0,
                                minHeight: 58,
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                justifyContent: "center",
                                padding: "9px 10px",
                                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                                borderRadius: 7,
                                background: active ? "var(--bg-selected)" : "var(--bg-panel)",
                                color: "var(--text)",
                                cursor: "pointer",
                                textAlign: "left",
                                boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)" : "none",
                              }}
                            >
                              <span style={{
                                fontSize: 13,
                                fontFamily: "var(--font-mono)",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                              }}>
                                /{command.name}
                              </span>
                              {command.description && (
                                <span style={{
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: 2,
                                  overflow: "hidden",
                                  fontSize: 11,
                                  lineHeight: 1.35,
                                  color: "var(--text-dim)",
                                }}>
                                  {command.description}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
            const matchCountLabel = `${atMatches.length} ${t(atMatches.length === 1 ? "match" : "matches")}`;
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
              ? (atQuery.query ? ` · ${t("searchingAllFiles")}` : ` · ${t("indexTruncated")}`)
              : "";
            return (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: "calc(100% + 8px)",
                  zIndex: 120,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
                  overflow: "hidden",
                  maxHeight: "min(48vh, 400px)",
                }}
              >
                <div
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  <span>
                    {indexLoading
                      ? t("loadingFiles")
                      : `${t("files")} · ${matchCountLabel}${truncatedHint}`}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{t("tabOrEnter")}</span>
                </div>
                <div style={{ maxHeight: "calc(min(48vh, 400px) - 34px)", overflowY: "auto", padding: 4 }}>
                  {!indexLoading && atMatches.length === 0 ? (
                    <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-dim)" }}>
                      {needsServerSearch && !serverResultInUse ? t("searching") : t("noMatchingFiles")}
                    </div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split("/").pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <button
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => {
                            atItemRefs.current[index] = node;
                          }}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 8px",
                            border: "none",
                            borderRadius: 6,
                            background: active ? "var(--bg-selected)" : "none",
                            color: "var(--text)",
                            cursor: "pointer",
                            textAlign: "left",
                            fontSize: 12.5,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                            {entry.isDir ? <FolderIcon size={14} name={name} /> : getFileIcon(name, 14)}
                          </span>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
          <div
            className={`chat-input-shell ${isStreaming && (onSteer || onFollowUp) ? "is-streaming" : ""}`}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (!target.closest("button, input, select, [role=button]")) textareaRef.current?.focus();
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 0,
              padding: 0,
              transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
            } as React.CSSProperties}
          >
          {isStreaming && <div className="chat-input-streaming-overlay hatch-45" aria-hidden="true" />}
          <div className="chat-input-editor-row">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              updateAtQuery(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onInput={handleInput}
            onPaste={handlePaste}
            placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? t("steerOrQueueFollowUp")
                : isStreaming ? t("agentRunning")
                : t("messageWithCommands")
            }
            rows={1}
            className="chat-input-textarea"
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              minHeight: 24,
              maxHeight: 200,
              padding: 0,
              overflow: "auto",
            }}
          />

          {isStreaming ? (
            <div className="chat-input-primary-actions" style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, alignSelf: "flex-end" }}>
              {onSteer && (
                <button
                  onClick={() => sendQueued("steer")}
                  disabled={!canQueueStreamingMessage}
                  title={attachedImages.length ? t("imageAttachmentsCannotQueue") : t("injectMessageNow")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 12px",
                    background: canQueueStreamingMessage ? "rgba(234,179,8,0.12)" : "none",
                    border: "1px solid rgba(234,179,8,0.35)",
                    borderRadius: 8,
                    color: canQueueStreamingMessage ? "rgba(180,130,0,1)" : "var(--text-dim)",
                    cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                    transition: "background 0.12s",
                  }}
                >
                  <ArrowElbowDownRightIcon size={12} />
                  {t("steer")}
                </button>
              )}
              {onFollowUp && (
                <button
                  onClick={() => sendQueued("followup")}
                  disabled={!canQueueStreamingMessage}
                  title={attachedImages.length ? t("imageAttachmentsCannotQueue") : t("queueMessageAfterFinish")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 12px",
                    background: canQueueStreamingMessage ? "rgba(129,140,248,0.12)" : "none",
                    border: "1px solid rgba(129,140,248,0.35)",
                    borderRadius: 8,
                    color: canQueueStreamingMessage ? "rgba(99,102,241,1)" : "var(--text-dim)",
                    cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                    transition: "background 0.12s",
                  }}
                >
                  <ArrowUpIcon size={12} />
                  {t("followUp")}
                </button>
              )}
            </div>
          ) : null}
          </div>

        {/* Bottom bar: left | center (context) | right */}
        <div className="chat-input-toolbar" style={{
          display: isMobile ? "grid" : "flex",
          gridTemplateColumns: isMobile ? "minmax(0, 1fr) auto" : undefined,
          alignItems: "center",
          gap: 4,
        }}>

          {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
          <div className="chat-input-toolbar-left" style={{ flex: isMobile ? "1 1 auto" : "0 0 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 2 }}>
            <button
              className="chat-input-toolbar-attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              title={t("attachImage")}
              aria-label={t("attachImage")}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, padding: 0,
                background: "none", border: "none",
                borderRadius: 9,
                color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                cursor: isStreaming ? "not-allowed" : "pointer",
                opacity: isStreaming ? 0.5 : 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (isStreaming) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <PlusIcon size={14} />
            </button>
            {onSoundToggle !== undefined && (
              <button
                className="chat-input-toolbar-sound"
                onClick={onSoundToggle}
                title={soundEnabled ? t("disableCompletionSound") : t("enableCompletionSound")}
                aria-label={soundEnabled ? t("disableCompletionSound") : t("enableCompletionSound")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  width: 28,
                  height: 28,
                  padding: 0,
                  background: "none",
                  border: "none",
                  borderRadius: 9,
                  color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: "pointer",
                  opacity: soundEnabled ? 1 : 0.55,
                  transition: "background 0.12s, color 0.12s, opacity 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
                }}
              >
                {soundEnabled ? <SpeakerHighIcon size={14} /> : <SpeakerSlashIcon size={14} />}
              </button>
            )}
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} className="chat-input-toolbar-thinking" style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setThinkingDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title={t("changeReasoningLevel").replace("{level}", thinkingDisplayLabel)}
                  aria-label={t("reasoningLevel")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 5px" : "6px 10px",
                    width: isMobile ? "auto" : undefined,
                    height: 28,
                    background: thinkingDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <LightbulbIcon size={14} />
                  {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
                </button>
                {thinkingDropdownOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 180,
                  }}>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                      const desc = thinkingLevelDescriptions[lvl];
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : thinkingLevelLabels[lvl];
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <CheckIcon size={10} color="var(--accent)" style={{ flexShrink: 0 }} />
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>
                            {displayLabel}
                            {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* spacer */}
          {!isMobile && <div className="chat-input-toolbar-spacer" style={{ flex: 1 }} />} 

          {/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
          <div ref={controlsMenuRef} className="chat-input-toolbar-controls" style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            position: "relative",
            marginLeft: isMobile ? 0 : "auto",
          }}>
            {isMobile && (
              <button
                type="button"
                title={controlsMenuOpen ? undefined : t("moreControls")}
                aria-label={t("moreControls")}
                aria-expanded={controlsMenuOpen}
                aria-hidden={controlsMenuOpen || undefined}
                tabIndex={controlsMenuOpen ? -1 : undefined}
                onClick={() => {
                  setModelDropdownOpen(false);
                  setControlsMenuOpen(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: 28,
                  padding: "6px 8px",
                  background: "none",
                  border: "none",
                  borderRadius: 9,
                  color: "var(--text-muted)",
                  cursor: controlsMenuOpen ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 500,
                  visibility: controlsMenuOpen ? "hidden" : "visible",
                  pointerEvents: controlsMenuOpen ? "none" : "auto",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (controlsMenuOpen) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  if (controlsMenuOpen) return;
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                {t("more")}
              </button>
            )}
            <div className="chat-input-toolbar-actions" style={{
              display: isMobile ? (controlsMenuOpen ? "flex" : "none") : "flex",
              alignItems: "center",
              gap: isMobile ? 1 : 2,
              ...(isMobile ? {
                position: "absolute",
                right: 0,
                bottom: 0,
                zIndex: 60,
                padding: 1,
                width: "max-content",
                maxWidth: "calc(100vw - 32px)",
                flexWrap: "nowrap",
                justifyContent: "flex-end",
                border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--bg-panel) 92%, var(--bg))",
                boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                backdropFilter: "blur(10px)",
              } : null),
            }}>
            {!isStreaming && onCompact && (
              <div className="chat-input-toolbar-compact" style={{ position: "relative" }}>
                {compactError && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    background: "#1f2937", color: "#f87171",
                    fontSize: 11, padding: "4px 8px", borderRadius: 5,
                    whiteSpace: "nowrap", pointerEvents: "none",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)", zIndex: 50,
                  }}>
                    {compactError}
                  </div>
                )}
                <button
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 5px" : "6px 10px",
                    width: isMobile ? "auto" : undefined,
                    height: 28,
                    background: isCompacting ? "rgba(239,68,68,0.08)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: isCompacting ? "#ef4444" : "var(--text-muted)",
                    cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                    fontSize: 12, opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming && !isCompacting) return;
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.16)" : "var(--bg-hover)";
                    e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.08)" : "none";
                    e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text-muted)";
                  }}
                  title={isCompacting ? t("stopCompaction") : t("compactContext")}
                  aria-label={isCompacting ? t("stopCompaction") : t("compactContext")}
                >
                  {isCompacting ? (
                    <><SquareIcon size={14} />{(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{t("compacting")}</span>}</>
                  ) : (
                    <><ArrowsInIcon size={14} />{(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{t("compact")}</span>}</>
                  )}
                </button>
              </div>
            )}

            {!isStreaming && onToolPresetChange && (
              <div ref={toolDropdownRef} className="chat-input-toolbar-tools" style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setToolDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title={t("changeToolPreset").replace("{preset}", toolPresetLabel)}
                  aria-label={t("toolPreset")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 5px" : "6px 10px",
                    width: isMobile ? "auto" : undefined,
                    height: 28,
                    background: toolDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = toolDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <WrenchIcon size={14} />
                  {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{toolPresetLabel}</span>}
                </button>
                {toolDropdownOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 120,
                  }}>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "default") === preset;
                      const desc = lvl === "off" ? t("noToolsReadOnly") : lvl === "default" ? t("fourBuiltInTools") : t("allBuiltInTools");
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <CheckIcon size={10} color="var(--accent)" style={{ flexShrink: 0 }} />
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>{toolPresetLabels[lvl]}</span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Model selector — visible always, disabled during streaming */}
            {modelOptions.length > 0 && currentName && onModelChange && (
                <div ref={dropdownRef} className="chat-input-toolbar-model" style={{ position: "relative", flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
                  <button
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      setModelDropdownOpen((v) => !v);
                    }}
                    disabled={isStreaming}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      justifyContent: isMobile ? "flex-start" : undefined,
                      padding: isMobile ? "6px 8px" : "6px 10px",
                      height: 28,
                      width: isMobile ? "100%" : undefined,
                      maxWidth: isMobile ? "100%" : 220,
                      overflow: "hidden",
                      background: modelDropdownOpen ? "var(--bg-hover)" : "none",
                      border: "none",
                      borderRadius: 9,
                      color: "var(--text-muted)",
                      cursor: isStreaming ? "not-allowed" : "pointer",
                      fontSize: 12,
                      opacity: isStreaming ? 0.5 : 1,
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (isStreaming) return;
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = modelDropdownOpen ? "var(--bg-hover)" : "none";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    <CpuIcon size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{currentName}</span>
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (() => {
                    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
                    const bottom = viewportHeight - modelDropdownRect.top + 6;
                    const maxH = Math.max(120, Math.min(modelDropdownRect.top - 8, viewportHeight * 0.6));
                    // On mobile, pin to a small left margin and cap width to the
                    // viewport so long model names never push the panel off-screen.
                    const panelPos: React.CSSProperties = isMobile
                      ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
                      : { left: modelDropdownRect.left, width: "max-content", minWidth: modelDropdownRect.width };
                    return (
                      <div ref={modelDropdownPanelRef} style={{
                      position: "fixed",
                      bottom,
                      ...panelPos,
                      zIndex: 500, background: "var(--bg)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                      overflow: "hidden", maxHeight: maxH, overflowY: "auto",
                      }}>
                      {modelsByProvider.map((group, gi) => (
                        <div key={group.provider}>
                          {(modelsByProvider.length > 1) && (
                            <div style={{
                              padding: "6px 12px 4px",
                              fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                              textTransform: "uppercase", letterSpacing: "0.07em",
                              borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                            }}>
                              {group.provider}
                            </div>
                          )}
                          {group.options.map((opt) => {
                            const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                            return (
                              <button
                                key={`${opt.provider}:${opt.modelId}`}
                                onClick={() => { setModelDropdownOpen(false); if (!isActive || isAutoModelSelection) onModelChange(opt.provider, opt.modelId); }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  width: "100%", padding: "7px 12px",
                                  background: isActive ? "var(--bg-selected)" : "none",
                                  border: "none",
                                  color: isActive ? "var(--text)" : "var(--text-muted)",
                                  cursor: "pointer", fontSize: 12, textAlign: "left",
                                  fontWeight: isActive ? 600 : 400,
                                  whiteSpace: "nowrap",
                                }}
                                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                              >
                                {isActive
                                  ? <CheckIcon size={10} color="var(--accent)" style={{ flexShrink: 0 }} />
                                  : <span style={{ width: 10, flexShrink: 0 }} />}
                                {opt.name}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    );
                  })()}
                </div>
            )}

            {!isStreaming && (
              <button
                type="button"
                onClick={handleSend}
                disabled={!value.trim() && !attachedImages.length}
                className="chat-input-send"
                title={t("sendMessage")}
                aria-label={t("sendMessage")}
              >
                <PaperPlaneTiltIcon size={14} />
              </button>
            )}

            {isStreaming && (
              <button
                onClick={onAbort}
                title={t("stopAgent")}
                aria-label={t("stopAgent")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 10px",
                  height: 28,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 9,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: "-0.01em",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.16)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
              >
                <SquareIcon size={14} />
                {t("stop")}
              </button>
            )}

            {isMobile && controlsMenuOpen && (
              <button
                type="button"
                title={t("collapseControls")}
                aria-label={t("collapseControls")}
                aria-expanded={true}
                onClick={() => {
                  setToolDropdownOpen(false);
                  setThinkingDropdownOpen(false);
                  setControlsMenuOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 28,
                  padding: 0,
                  marginLeft: 0,
                  background: "var(--bg-hover)",
                  border: "none",
                  borderLeft: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                  borderRadius: "0 9px 9px 0",
                  color: "var(--text)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
              >
                <XIcon size={13} />
              </button>
            )}
            </div>
          </div>
        </div>

        </div>
      </div>
    </div>
    </div>
  );
});
