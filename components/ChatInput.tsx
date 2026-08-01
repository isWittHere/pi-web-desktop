"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import { clearDraft, getDraft, setDraft, type ChatDraftImage } from "@/lib/draft-store";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { ArrowBendUpLeftIcon } from "@phosphor-icons/react/ArrowBendUpLeft";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowElbowUpLeftIcon } from "@phosphor-icons/react/ArrowElbowUpLeft";
import { SortDescendingIcon } from "@phosphor-icons/react/SortDescending";

import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { LightbulbIcon } from "@phosphor-icons/react/Lightbulb";
import { LightningIcon } from "@phosphor-icons/react/Lightning";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/PaperPlaneTilt";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { SquareIcon } from "@phosphor-icons/react/Square";
import { StarIcon } from "@phosphor-icons/react/Star";
import { StarFourIcon } from "@phosphor-icons/react/StarFour";
import { ProviderIcon } from "./ProviderIcon";
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
  onBash?: (command: string, excludeFromContext: boolean) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  compactResult?: CompactResultInfo | null;
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  inputHistory?: string[];
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
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

const THINKING_LEVELS = ["max", "xhigh", "high", "medium", "low", "minimal", "auto", "off"] as const;

function ThinkingLevelIcon({ level, size = 14 }: { level: (typeof THINKING_LEVELS)[number]; size?: number }) {
  if (level === "off") {
    return <LightbulbIcon size={size} weight="regular" color="var(--text-dim)" />;
  }

  if (level === "auto") {
    return <StarFourIcon size={size} weight="regular" color="var(--accent)" />;
  }

  const useFill = ["medium", "high", "xhigh", "max"].includes(level);
  const bulbWeight = useFill ? "fill" : "regular";
  const accentColor = "var(--accent)";

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <LightbulbIcon size={size} weight={bulbWeight} color={accentColor} />
      {level === "high" && (
        <PlusIcon
          size={Math.round(size * 0.57)}
          weight="bold"
          color={accentColor}
          style={{ position: "absolute", right: -4, top: -1 }}
        />
      )}
      {level === "xhigh" && (
        <LightningIcon
          size={Math.round(size * 0.57)}
          weight="fill"
          color={accentColor}
          style={{ position: "absolute", right: -4, top: -1 }}
        />
      )}
      {level === "max" && (
        <span style={{ position: "absolute", right: -6, top: -1, display: "inline-flex" }}>
          <LightningIcon size={Math.round(size * 0.5)} weight="fill" color={accentColor} style={{ marginRight: -3 }} />
          <LightningIcon size={Math.round(size * 0.5)} weight="fill" color={accentColor} />
        </span>
      )}
    </span>
  );
}



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

function isDormantSkillCommand(command: SlashCommandPaletteItem, dormancy: Record<string, boolean>): boolean {
  return command.source === "skill"
    && command.name.startsWith("skill:")
    && dormancy[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(
  commands: SlashCommandPaletteItem[],
  dormancy: Record<string, boolean>,
) {
  let index = 0;
  const groups = SLASH_SOURCES
    .map((source) => {
      const sourceCommands = commands.filter((command) => command.source === source);
      const orderedCommands = source === "skill"
        ? [
            ...sourceCommands.filter((command) => !isDormantSkillCommand(command, dormancy)),
            ...sourceCommands.filter((command) => isDormantSkillCommand(command, dormancy)),
          ]
        : sourceCommands;
      return {
        source,
        items: orderedCommands.map((command) => ({ command, index: index++ })),
      };
    })
    .filter((group) => group.items.length > 0);
  return { commands: groups.flatMap((group) => group.items.map(({ command }) => command)), groups };
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
  onSend, onBash, onAbort, onSteer, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, modelScopeWarnings, onModelChange,
  compactResult, toolPreset, onToolPresetChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
}: Props, ref) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  // Thinking levels are model-facing identifiers, so keep their labels in English.
  const thinkingLevelLabels: Record<typeof THINKING_LEVELS[number], string> = {
    auto: "auto",
    off: "off",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  };
  const toolPresetLabels: Record<typeof TOOL_PRESETS[number], string> = {
    off: t("desktop.toolOff"),
    default: t("desktop.toolDefault"),
    full: t("desktop.toolFull"),
  };
  const builtinSlashCommands: SlashCommandPaletteItem[] = [
    { name: "compact", description: t("desktop.compactCommandDescription"), source: "builtin" },
    { name: "reload", description: t("desktop.reloadCommandDescription"), source: "builtin" },
    { name: "name", description: t("desktop.nameCommandDescription"), source: "builtin" },
    { name: "session", description: t("desktop.sessionCommandDescription"), source: "builtin" },
    { name: "copy", description: t("desktop.copyCommandDescription"), source: "builtin" },
  ];
  const slashSourceGroupLabels: Record<SlashCommandSource, string> = {
    builtin: t("desktop.builtIn"),
    extension: t("desktop.extensions"),
    prompt: t("desktop.prompts"),
    skill: t("desktop.commandSkills"),
  };
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("pi-favorite-models");
      return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [toolDropdownRect, setToolDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [thinkingDropdownRect, setThinkingDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? getDraft(draftKey)?.images.map(draftImageToAttachedImage) ?? [] : []
  ));
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [skillDormancy, setSkillDormancy] = useState<Record<string, boolean>>({});
  const [inputShortcut, setInputShortcut] = useState<"enter" | "ctrl-enter">(() => {
    try {
      return localStorage.getItem("pi-input-shortcut") === "ctrl-enter" ? "ctrl-enter" : "enter";
    } catch { return "enter"; }
  });
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
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

  const toggleFavorite = useCallback((provider: string, modelId: string) => {
    setFavorites((prev) => {
      const key = `${provider}:${modelId}`;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem("pi-favorite-models", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const toggleProviderExpand = useCallback((provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider); else next.add(provider);
      return next;
    });
  }, []);

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
    const handler = () => {
      try {
        setInputShortcut(localStorage.getItem("pi-input-shortcut") === "ctrl-enter" ? "ctrl-enter" : "enter");
      } catch { setInputShortcut("enter"); }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

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
    if (!attachedImages.length && msg.startsWith("!") && onBash) {
      const excludeFromContext = msg.startsWith("!!");
      const command = msg.slice(excludeFromContext ? 2 : 1).trim();
      if (!command) return;
      onBash(command, excludeFromContext);
      clearInput();
      return;
    }
    if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (!result.error) clearInput();
        return;
      }
    }
    onSend(msg, attachedImages.length ? attachedImages : undefined);
    clearInput();
  }, [value, attachedImages, isStreaming, onBash, onBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const matchedSlashCommands = (() => {
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

  const { commands: filteredSlashCommands, groups: groupedSlashCommands } = buildSlashCommandLayout(
    matchedSlashCommands,
    skillDormancy,
  );

  useEffect(() => {
    if (!slashMenuOpen || !cwd) return;
    let cancelled = false;
    fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
      .then((response) => response.ok ? response.json() as Promise<SkillsResponse> : null)
      .then((data) => {
        if (cancelled || !data) return;
        setSkillDormancy(Object.fromEntries(
          data.skills.map((skill) => [skill.name, skill.disableModelInvocation]),
        ));
      })
      .catch(() => {
        // The slash menu remains usable if skill metadata cannot be refreshed.
      });
    return () => { cancelled = true; };
  }, [cwd, slashMenuOpen]);

  const slashCommandCountLabel = `${filteredSlashCommands.length} ${t(
    slashQuery
      ? (filteredSlashCommands.length === 1 ? "desktop.match" : "desktop.matches")
      : (filteredSlashCommands.length === 1 ? "desktop.command" : "desktop.commands")
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

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

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

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "i" && !isComposing && cwd) {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? start;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        const separator = before && !/[\s@]$/.test(before) ? " " : "";
        const nextValue = `${before}${separator}@${after}`;
        const cursor = before.length + separator.length + 1;
        setValue(nextValue);
        setAtQuery(extractAtQuery(nextValue.slice(0, cursor)));
        setAtMenuOpen(true);
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(cursor, cursor);
        });
        return;
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((index) => Math.min(Math.max(0, (inputHistory?.length ?? 0) - 1), index + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && inputHistory?.[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
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

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && (inputHistory?.length ?? 0) > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(0);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@ menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        // Ctrl+Enter mode: Enter inserts newline, Ctrl+Enter sends
        if (inputShortcut === "ctrl-enter" && !(e.ctrlKey || e.metaKey)) {
          // Let the textarea handle the newline naturally
          return;
        }
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Default Enter sends as steer if available, else followup
          sendQueued(onSteer ? "steer" : "followup");
        } else {
          handleSend();
        }
      }
    },
    [isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, filteredSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, inputShortcut, cwd, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value]
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
    if (historyActiveIndex >= (inputHistory?.length ?? 0)) {
      setHistoryActiveIndex(Math.max(0, (inputHistory?.length ?? 0) - 1));
    }
  }, [historyActiveIndex, inputHistory]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory?.length ?? 0;
  }, [inputHistory]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

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
    ? `${t("desktop.compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} ${t("desktop.tokens")} (${formatTokenCount(compactSavedTokens)} ${t("desktop.saved")})`
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

  // Every time the model dropdown expands, focus the search input so the
  // user can start typing a filter immediately.
  useEffect(() => {
    if (modelDropdownOpen) modelSearchRef.current?.focus();
  }, [modelDropdownOpen]);



  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 15px",
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
        {modelScopeWarnings && modelScopeWarnings.length > 0 && (
          <div
            role="status"
            style={{
              marginBottom: 8,
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid color-mix(in srgb, var(--accent-orange) 45%, var(--border))",
              background: "color-mix(in srgb, var(--accent-orange) 9%, var(--bg-panel))",
              color: "var(--text-muted)",
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {modelScopeWarnings.join(" ")}
          </div>
        )}
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
                {t("desktop.queued")} · {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                  title={t("desktop.recallQueuedMessages")}
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
                  {t("desktop.recallToInput")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow key={`steer-${i}`} kind="steer" label={t("desktop.steer")} text={text} />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow key={`followup-${i}`} kind="follow-up" label={t("desktop.followUp")} text={text} />
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
            {t("desktop.retrying")} ({retryInfo.attempt}/{retryInfo.maxAttempts})…{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
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
                  title={t("desktop.removeImage")}
                  aria-label={t("desktop.removeImage")}
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
          {historyMenuOpen && inputHistory.length > 0 && (
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
                maxHeight: "min(38vh, 300px)",
              }}
            >
              <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", color: "var(--text-dim)", fontSize: 11 }}>
                <span>{t("desktop.inputHistory")}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{t("desktop.tabOrEnter")}</span>
              </div>
              <div style={{ maxHeight: "calc(min(38vh, 300px) - 24px)", overflowY: "auto", padding: 4 }}>
                {inputHistory.map((item, index) => (
                  <button
                    key={`${index}:${item}`}
                    ref={(node) => { historyItemRefs.current[index] = node; }}
                    type="button"
                    onMouseDown={(event) => { event.preventDefault(); applyHistoryInput(item); }}
                    onMouseEnter={() => setHistoryActiveIndex(index)}
                    style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 6px", border: "none", borderRadius: 5, background: index === historyActiveIndex ? "var(--bg-selected)" : "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ flexShrink: 0, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{index + 1}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{item}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
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
                maxHeight: "min(38vh, 300px)",
              }}
            >
              <div
                style={{
                  padding: "4px 8px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                <span>{slashCommandsLoading ? t("desktop.loadingCommands") : `${t("desktop.slashCommands")} · ${slashCommandCountLabel}`}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{t("desktop.tabOrEnter")}</span>
              </div>
              <div style={{ maxHeight: "calc(min(38vh, 300px) - 24px)", overflowY: "auto", padding: 4 }}>
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "2px 2px 2px", fontSize: 12, color: "var(--text-dim)" }}>
                    {t("desktop.noSlashCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: 6 }}>
                      <div
                        style={{
                          position: "sticky",
                          top: -4,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "2px 0 4px",
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
                          display: "flex",
                          flexDirection: "column",
                          gap: 1,
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
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "3px 6px",
                                border: "none",
                                borderRadius: 5,
                                background: active ? "var(--bg-selected)" : "none",
                                color: "var(--text)",
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                            >
                              <span style={{
                                fontSize: 12.5,
                                fontFamily: "var(--font-mono)",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                              }}>
                                /{command.name}
                              </span>
                              {command.description && (
                                <span style={{
                                  fontSize: 12,
                                  color: "var(--text-dim)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  minWidth: 0,
                                }}>
                                  {command.description}
                                </span>
                              )}
                              {isDormantSkillCommand(command, skillDormancy) && (
                                <span style={{
                                  marginLeft: "auto",
                                  flexShrink: 0,
                                  padding: "1px 5px",
                                  borderRadius: 999,
                                  border: "1px solid var(--border)",
                                  color: "var(--text-dim)",
                                  fontSize: 10,
                                }}>
                                  {t("desktop.dormant")}
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
            const matchCountLabel = `${atMatches.length} ${t(atMatches.length === 1 ? "desktop.match" : "desktop.matches")}`;
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
              ? (atQuery.query ? ` · ${t("desktop.searchingAllFiles")}` : ` · ${t("desktop.indexTruncated")}`)
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
                  maxHeight: "min(30vh, 240px)",
                }}
              >
                <div
                  style={{
                    padding: "4px 8px",
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
                      ? t("desktop.loadingFiles")
                      : `${t("desktop.files")} · ${matchCountLabel}${truncatedHint}`}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{t("desktop.tabOrEnter")}</span>
                </div>
                <div style={{ maxHeight: "calc(min(30vh, 240px) - 24px)", overflowY: "auto", padding: 2 }}>
                  {!indexLoading && atMatches.length === 0 ? (
                    <div style={{ padding: "4px 6px", fontSize: 12, color: "var(--text-dim)" }}>
                      {needsServerSearch && !serverResultInUse ? t("desktop.searching") : t("desktop.noMatchingFiles")}
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
                            gap: 5,
                            padding: "3px 6px",
                            border: "none",
                            borderRadius: 5,
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
          {isStreaming && (onSteer || onFollowUp) && (
            <div className="chat-input-streaming-actions">
              {onSteer && (
                <button
                  type="button"
                  className="chat-input-streaming-action chat-input-streaming-action-steer"
                  onClick={() => sendQueued("steer")}
                  disabled={!canQueueStreamingMessage}
                  title={attachedImages.length ? t("desktop.imageAttachmentsCannotQueue") : t("desktop.injectMessageNow")}
                  aria-label={t("desktop.steer")}
                >
                  <ArrowElbowUpLeftIcon size={15} />
                </button>
              )}
              {onFollowUp && (
                <button
                  type="button"
                  className="chat-input-streaming-action"
                  onClick={() => sendQueued("followup")}
                  disabled={!canQueueStreamingMessage}
                  title={attachedImages.length ? t("desktop.imageAttachmentsCannotQueue") : t("desktop.queueMessageAfterFinish")}
                  aria-label={t("desktop.followUp")}
                >
                  <SortDescendingIcon size={15} />
                </button>
              )}
            </div>
          )}
          <div className="chat-input-editor-row" style={{ borderColor: bashMode ? "var(--tool-bg)" : undefined }}>
          <textarea
            ref={textareaRef}
            value={value}
            spellCheck={false}
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
                ? t("desktop.steerOrQueueFollowUp")
                : isStreaming ? t("desktop.agentRunning")
                : t("desktop.messageWithCommands")
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

          </div>

        {bashMode && (
          <div style={{ marginTop: 4, padding: "2px 8px", fontSize: 11, color: bashExcluded ? "var(--text-muted)" : "var(--accent)" }}>
            {t("desktop.shellCommand")} · {bashExcluded ? t("desktop.shellOutputLocal") : t("desktop.shellOutputModel")}
          </div>
        )}

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
              title={t("desktop.attachImage")}
              aria-label={t("desktop.attachImage")}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, padding: 0,
                background: "none", border: "none",
                borderRadius: 6,
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
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} className="chat-input-toolbar-thinking" style={{ position: "relative" }}>
                <button
                  onClick={(e) => { if (isStreaming) return; const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setThinkingDropdownRect({ top: rect.top, left: rect.left, width: rect.width }); setThinkingDropdownOpen((v) => !v); }}
                  disabled={isStreaming}
                  title={t("desktop.changeReasoningLevel", { level: thinkingDisplayLabel })}
                  aria-label={t("desktop.reasoningLevel")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 5px" : "3px 7px",
                    width: isMobile ? "auto" : undefined,
                    height: 24,
                    background: thinkingDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 6,
                    color: (thinkingLevel ?? "auto") === "off" ? "var(--text-dim)" : "var(--accent)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                  }}
                >
                  <ThinkingLevelIcon level={thinkingLevel ?? "auto"} />
                  {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
                  <CaretDownIcon
                    size={11}
                    weight="bold"
                    aria-hidden="true"
                    style={{ transform: thinkingDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s" }}
                  />
                </button>
                {thinkingDropdownOpen && thinkingDropdownRect && (() => {
                    const vh = window.visualViewport?.height ?? window.innerHeight;
                    const vw = window.innerWidth;
                    const panelMaxW = Math.min(240, vw - 16);
                    // Anchor the menu's bottom-right to the selector's top-right.
                    const l = Math.min(thinkingDropdownRect.left, vw - panelMaxW - 8);
                    const b = vh - thinkingDropdownRect.top + 4;
                    const maxH = Math.min(360, Math.max(120, Math.min(thinkingDropdownRect.top - 8, vh * 0.6)));
                    return (
                  <div style={{
                    position: "fixed", bottom: b, left: l,
                    zIndex: 2001, background: "var(--bg-panel)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                    overflow: "hidden", minWidth: 200, maxWidth: panelMaxW, maxHeight: maxH, overflowY: "auto",
                  }}>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : thinkingLevelLabels[lvl];
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "6px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--accent)" : "var(--text)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontFamily: "var(--font-mono)",
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          <ThinkingLevelIcon level={lvl} size={14} />
                          <span style={{ flex: 1 }}>
                            {displayLabel}
                            {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 5 }}>({lvl})</span>}
                          </span>
                          {isActive && <CheckIcon size={12} weight="bold" color="var(--accent)" style={{ flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                    );
                  })()}
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
                title={controlsMenuOpen ? undefined : t("desktop.moreControls")}
                aria-label={t("desktop.moreControls")}
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
                  height: 24,
                  padding: "3px 5px",
                  background: "none",
                  border: "none",
                  borderRadius: 6,
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
                {t("desktop.more")}
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
            {!isStreaming && onToolPresetChange && (
              <div ref={toolDropdownRef} className="chat-input-toolbar-tools" style={{ position: "relative" }}>
                <button
                  onClick={(e) => { if (isStreaming) return; const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setToolDropdownRect({ top: rect.top, left: rect.left, width: rect.width }); setToolDropdownOpen((v) => !v); }}
                  disabled={isStreaming}
                  title={t("desktop.changeToolPreset", { preset: toolPresetLabel })}
                  aria-label={t("desktop.toolPreset")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 5px" : "3px 7px",
                    width: isMobile ? "auto" : undefined,
                    height: 24,
                    background: toolDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 6,
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
                  {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{toolPresetLabel}</span>}
                  <CaretDownIcon
                    size={11}
                    weight="bold"
                    aria-hidden="true"
                    style={{ transform: toolDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s" }}
                  />
                </button>
                {toolDropdownOpen && toolDropdownRect && (() => {
                    const vh = window.visualViewport?.height ?? window.innerHeight;
                    const vw = window.innerWidth;
                    const panelMaxW = Math.min(200, vw - 16);
                    // Anchor the menu's bottom-right corner to the selector's
                    // top-right corner. `right` preserves the alignment even
                    // when the menu width follows its content.
                    const r = Math.max(8, vw - (toolDropdownRect.left + toolDropdownRect.width));
                    const b = vh - toolDropdownRect.top + 6;
                    const maxH = Math.min(320, Math.max(100, Math.min(toolDropdownRect.top - 8, vh * 0.5)));
                    return (
                  <div style={{
                    position: "fixed", bottom: b, right: r,
                    zIndex: 2001, background: "var(--bg-panel)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                    overflow: "hidden", minWidth: 120, maxWidth: panelMaxW, maxHeight: maxH, overflowY: "auto",
                  }}>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "default") === preset;
                      const desc = lvl === "off" ? t("desktop.noToolsReadOnly") : lvl === "default" ? t("desktop.fourBuiltInTools") : t("desktop.allBuiltInTools");
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "6px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--accent)" : "var(--text)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontFamily: "var(--font-mono)",
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          <span style={{ flex: 1 }}>{toolPresetLabels[lvl]}</span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                          {isActive && <CheckIcon size={12} weight="bold" color="var(--accent)" style={{ flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                    );
                  })()}
              </div>
            )}

            {/* Model selector — visible always, disabled during streaming */}
            {modelOptions.length > 0 && currentName && onModelChange && (
                <div ref={dropdownRef} className="chat-input-toolbar-model" style={{ position: "relative", flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
                  <button
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      if (!modelDropdownOpen) setModelSearch("");
                      setModelDropdownOpen((v) => !v);
                    }}
                    disabled={isStreaming}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      justifyContent: isMobile ? "flex-start" : undefined,
                      padding: isMobile ? "4px 6px" : "3px 7px",
                      height: 24,
                      width: isMobile ? "100%" : undefined,
                      maxWidth: isMobile ? "100%" : 220,
                      overflow: "hidden",
                      background: modelDropdownOpen ? "var(--bg-hover)" : "none",
                      border: "none",
                      borderRadius: 6,
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
                    <ProviderIcon id={model?.provider ?? "unknown"} size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{currentName}</span>
                    <CaretDownIcon
                      size={11}
                      weight="bold"
                      aria-hidden="true"
                      style={{ flexShrink: 0, transform: modelDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s" }}
                    />
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (() => {
                    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
                    const viewportWidth = window.innerWidth;
                    const bottom = viewportHeight - modelDropdownRect.top + 6;
                    const maxH = Math.min(400, Math.max(120, Math.min(modelDropdownRect.top - 8, viewportHeight * 0.6)));
                    // On mobile, pin to a small left margin and cap width to the
                    // viewport so long model names never push the panel off-screen.
                    // On desktop, clamp left so the panel stays within the viewport.
                    const panelMinWidth = modelDropdownRect.width;
                    const panelMaxWidth = Math.min(360, viewportWidth - 16);
                    const panelPos: React.CSSProperties = isMobile
                      ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
                      : {
                          // Anchor the content-sized panel to the selector's
                          // right edge, while preserving an 8px viewport inset.
                          right: Math.max(8, viewportWidth - (modelDropdownRect.left + modelDropdownRect.width)),
                          width: "max-content",
                          minWidth: Math.min(panelMinWidth, panelMaxWidth),
                          maxWidth: panelMaxWidth,
                        };

                    // Build favorites list (preserving localStorage insertion order)
                    const favKeys = [...favorites];
                    const favModels: ModelOption[] = [];
                    for (const key of favKeys) {
                      const [provider, modelId] = key.split(":", 2);
                      const match = modelOptions.find((o) => o.provider === provider && o.modelId === modelId);
                      if (match) favModels.push(match);
                    }

                    // Model search filter — matches name, model id, and provider.
                    const searchQuery = modelSearch.trim().toLowerCase();
                    const isSearching = searchQuery.length > 0;
                    const matchesQuery = (opt: ModelOption) =>
                      opt.name.toLowerCase().includes(searchQuery) ||
                      opt.modelId.toLowerCase().includes(searchQuery) ||
                      opt.provider.toLowerCase().includes(searchQuery);
                    const favModelsFiltered = isSearching ? favModels.filter(matchesQuery) : favModels;
                    const hasFavs = favModelsFiltered.length > 0;
                    const filteredGroups = isSearching
                      ? modelsByProvider
                          .map((group) => ({ ...group, options: group.options.filter(matchesQuery) }))
                          .filter((group) => group.options.length > 0)
                      : modelsByProvider;
                    const hasAnyResults = hasFavs || filteredGroups.length > 0;

                    return (
                      <div ref={modelDropdownPanelRef} className="chat-input-model-dropdown" style={{
                      position: "fixed",
                      bottom,
                      ...panelPos,
                      zIndex: 2000, background: "var(--bg-panel)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                      overflow: "hidden", maxHeight: maxH,
                      display: "flex", flexDirection: "column",
                      }}>
                      {/* Search area — pinned above the list, separated by a divider */}
                      <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                          <MagnifyingGlassIcon
                            size={13}
                            color="var(--text-dim)"
                            style={{ position: "absolute", left: 12, pointerEvents: "none" }}
                          />
                          <input
                            ref={modelSearchRef}
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                if (modelSearch) {
                                  setModelSearch("");
                                } else {
                                  setModelDropdownOpen(false);
                                }
                              } else if (e.key === "ArrowDown") {
                                const firstRow = modelDropdownPanelRef.current?.querySelector<HTMLButtonElement>(".model-row button");
                                if (firstRow) {
                                  e.preventDefault();
                                  firstRow.focus();
                                }
                              }
                            }}
                            placeholder={t("desktop.searchModels")}
                            aria-label={t("desktop.searchModels")}
                            style={{
                              width: "100%",
                              padding: "5px 12px 5px 34px",
                              background: "transparent",
                              border: "none",
                              outline: "none",
                              color: "var(--text)",
                              fontSize: 12,
                              fontFamily: "var(--font-mono)",
                            }}
                            onFocus={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                            onBlur={(e) => { e.currentTarget.style.background = "transparent"; }}
                          />
                        </div>
                      </div>
                      {/* Scrollable results */}
                      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                      {/* Favorites group — at top, always expanded */}
                      {hasFavs && (
                        <div>
                          <div style={{
                            padding: "6px 12px 4px",
                            fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                            textTransform: "uppercase", letterSpacing: "0.07em",
                          }}>
                            {t("desktop.favorites")}
                          </div>
                          {favModelsFiltered.map((opt) => {
                            const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                            const isFav = favorites.has(`${opt.provider}:${opt.modelId}`);
                            return (
                              <div
                                key={`fav-${opt.provider}:${opt.modelId}`}
                                className="model-row"
                                style={{ display: "flex", alignItems: "center", width: "100%" }}
                              >
                                <button
                                  onClick={() => { setModelDropdownOpen(false); if (!isActive || isAutoModelSelection) onModelChange(opt.provider, opt.modelId); }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    flex: 1, minWidth: 0,
                                    padding: "6px 12px",
                                    background: isActive ? "var(--bg-selected)" : "none",
                                    border: "none",
                                    color: isActive ? "var(--accent)" : "var(--text)",
                                    cursor: "pointer", fontSize: 12, textAlign: "left",
                                    fontFamily: "var(--font-mono)",
                                    whiteSpace: "nowrap", overflow: "hidden",
                                  }}
                                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                                >
                                  <ProviderIcon id={opt.provider} size={14} />
                                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{opt.name}</span>
                                  {isActive && <CheckIcon size={12} weight="bold" color="var(--accent)" style={{ flexShrink: 0 }} />}
                                  <span
                                    onClick={(e) => { e.stopPropagation(); toggleFavorite(opt.provider, opt.modelId); }}
                                    className="model-star"
                                    style={{
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      flexShrink: 0,
                                      cursor: "pointer",
                                      color: isFav ? "var(--accent)" : "var(--text-dim)",
                                      opacity: isFav ? 1 : 0,
                                      transition: "opacity 0.12s, color 0.12s",
                                    }}
                                    onMouseEnter={(e) => { e.stopPropagation(); e.currentTarget.style.color = "var(--accent)"; }}
                                    onMouseLeave={(e) => { e.stopPropagation(); e.currentTarget.style.color = isFav ? "var(--accent)" : "var(--text-dim)"; }}
                                    title={isFav ? t("desktop.unfavorite") : t("desktop.favorite")}
                                    aria-label={isFav ? t("desktop.unfavorite") : t("desktop.favorite")}
                                  >
                                    <StarIcon size={12} weight={isFav ? "fill" : "regular"} />
                                  </span>
                                </button>
                              </div>
                            );
                          })}
                          <div style={{ borderTop: "1px solid var(--border)" }} />
                        </div>
                      )}
                      {/* Provider groups — clickable headers, default collapsed */}
                      {filteredGroups.map((group, gi) => {
                        const isExpanded = isSearching || expandedProviders.has(group.provider);
                        const caret = !isExpanded
                          ? <CaretRightIcon size={10} color="var(--text-dim)" />
                          : <CaretDownIcon size={10} color="var(--text-dim)" />;
                        return (
                        <div key={group.provider}>
                          <button
                            onClick={() => toggleProviderExpand(group.provider)}
                            style={{
                              display: "flex", alignItems: "center", gap: 4,
                              width: "100%", padding: "6px 12px 4px",
                              background: "none", border: "none",
                              cursor: "pointer",
                              fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                              textTransform: "uppercase", letterSpacing: "0.07em",
                              borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                          >
                            {caret}
                            {group.provider}
                          </button>
                          {isExpanded && group.options.map((opt) => {
                            const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                            const isFav = favorites.has(`${opt.provider}:${opt.modelId}`);
                            return (
                              <div
                                key={`${opt.provider}:${opt.modelId}`}
                                className="model-row"
                                style={{ display: "flex", alignItems: "center", width: "100%" }}
                              >
                                <button
                                  onClick={() => { setModelDropdownOpen(false); if (!isActive || isAutoModelSelection) onModelChange(opt.provider, opt.modelId); }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    flex: 1, minWidth: 0,
                                    padding: "6px 12px",
                                    background: isActive ? "var(--bg-selected)" : "none",
                                    border: "none",
                                    color: isActive ? "var(--accent)" : "var(--text)",
                                    cursor: "pointer", fontSize: 12, textAlign: "left",
                                    fontFamily: "var(--font-mono)",
                                    whiteSpace: "nowrap", overflow: "hidden",
                                  }}
                                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                                >
                                  <ProviderIcon id={opt.provider} size={14} />
                                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{opt.name}</span>
                                  {isActive && <CheckIcon size={12} weight="bold" color="var(--accent)" style={{ flexShrink: 0 }} />}
                                  <span
                                    onClick={(e) => { e.stopPropagation(); toggleFavorite(opt.provider, opt.modelId); }}
                                    className="model-star"
                                    style={{
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      flexShrink: 0,
                                      cursor: "pointer",
                                      color: isFav ? "var(--accent)" : "var(--text-dim)",
                                      opacity: isFav ? 1 : 0,
                                      transition: "opacity 0.12s, color 0.12s",
                                    }}
                                    onMouseEnter={(e) => { e.stopPropagation(); e.currentTarget.style.color = "var(--accent)"; }}
                                    onMouseLeave={(e) => { e.stopPropagation(); e.currentTarget.style.color = isFav ? "var(--accent)" : "var(--text-dim)"; }}
                                    title={isFav ? t("desktop.unfavorite") : t("desktop.favorite")}
                                    aria-label={isFav ? t("desktop.unfavorite") : t("desktop.favorite")}
                                  >
                                    <StarIcon size={12} weight={isFav ? "fill" : "regular"} />
                                  </span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        );
                      })}
                      {/* No matches while searching */}
                      {isSearching && !hasAnyResults && (
                        <div style={{ padding: "14px 12px", textAlign: "center", fontSize: 12, color: "var(--text-dim)" }}>
                          {t("desktop.noModelsMatch")}
                        </div>
                      )}
                      </div>
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
                title={t("desktop.sendMessage")}
                aria-label={t("desktop.sendMessage")}
              >
                <PaperPlaneTiltIcon size={14} />
              </button>
            )}

            {isStreaming && (
              <button
                onClick={onAbort}
                title={t("desktop.stopAgent")}
                aria-label={t("desktop.stopAgent")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 7px",
                  height: 24,
                  background: "rgba(239,68,68,0.12)",
                  border: "none",
                  borderRadius: 6,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: "-0.01em",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.20)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; }}
              >
                <SquareIcon size={14} />
                {t("desktop.stop")}
              </button>
            )}

            {isMobile && controlsMenuOpen && (
              <button
                type="button"
                title={t("desktop.collapseControls")}
                aria-label={t("desktop.collapseControls")}
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
                  width: 26,
                  height: 24,
                  padding: 0,
                  marginLeft: 0,
                  background: "var(--bg-hover)",
                  border: "none",
                  borderLeft: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                  borderRadius: "0 6px 6px 0",
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
