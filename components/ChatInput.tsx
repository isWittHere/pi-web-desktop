"use client";

import React, { useMemo, useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import { clearDraft, getDraft, setDraft, type ChatDraftImage } from "@/lib/draft-store";
import { continueMarkdownList } from "@/lib/markdown-list";
import type { ToolPreset } from "@/lib/tool-presets";
import { isBase64ImageWithinLimits } from "@/lib/image-attachments";
import type { TextContent, UserMessage } from "@/lib/types";
import {
  buildEntriesFromFiles, buildAtInsertText, buildFileAtMentionsText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { toCwdRelativeMentions } from "@/lib/file-mentions";
import { tokenizeMentions } from "@/lib/mention-tokens";
import { useFileIndex, useSkillNames } from "@/hooks/useProjectContext";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { cssPx, getUiScale } from "@/lib/ui-scale";
import type { ThinkingLevelOption } from "@/lib/thinking-levels";
import { filterThinkingLevelOptions } from "@/lib/thinking-levels";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableHeight } from "@/hooks/useResizableHeight";
import { scrollRemaining, nextInputCompactState, COMPACT_RESTORE_TRIGGER, type InputCompactScrollDirection } from "@/lib/input-compact";
import { useI18n } from "@/hooks/useI18n";
import { ArrowBendUpLeftIcon } from "@phosphor-icons/react/ArrowBendUpLeft";
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowElbowUpLeftIcon } from "@phosphor-icons/react/ArrowElbowUpLeft";
import { ArrowsInIcon } from "@phosphor-icons/react/ArrowsIn";
import { ArrowsOutIcon } from "@phosphor-icons/react/ArrowsOut";
import { AtIcon } from "@phosphor-icons/react/At";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { SortDescendingIcon } from "@phosphor-icons/react/SortDescending";

import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { LightbulbIcon } from "@phosphor-icons/react/Lightbulb";
import { LightningIcon } from "@phosphor-icons/react/Lightning";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PaperPlaneRightIcon } from "@phosphor-icons/react/PaperPlaneRight";
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
  api?: string;
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onBash?: (command: string, excludeFromContext: boolean) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  /** Compaction is running outside a prompt — the send slot becomes a Stop button */
  isCompacting?: boolean;
  /** Abort an in-progress compaction (used by the Stop button while compacting) */
  onAbortCompaction?: () => void;
  /** Current agent step name (thinking / editing / reading / executing…) shown in the streaming-actions row */
  stepLabel?: string | null;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; api?: string }[];
  /** `provider:modelId` → whether the model accepts image input. */
  imageInputByModel?: Record<string, boolean>;
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  compactResult?: CompactResultInfo | null;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: ToolPreset) => void;
  thinkingLevel?: ThinkingLevelOption;
  onThinkingLevelChange?: (level: ThinkingLevelOption) => void;
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
  /** Messages scroll container — the popup menus cap their height at its top edge */
  messagesScrollRef?: React.RefObject<HTMLDivElement | null>;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  /** Restore a historical user message (text + images) into the composer. */
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  addFileMentions: (files: File[]) => void;
}

const TOOL_PRESETS = ["off", "read-only", "default", "full"] as const;
type ToolPresetLabel = typeof TOOL_PRESETS[number];
const TOOL_PRESET_MAP: Record<ToolPresetLabel, ToolPreset> = {
  off: "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};
const COMPOSITION_END_ENTER_GRACE_MS = 100;
// Step pill lyric-roll: one viewport line per label, old text slides up while
// the new one slides in from below. Keep STEP_LINE_H in sync with the pill height.
const STEP_LINE_H = 28;
const STEP_ROLL_MS = 220;
// Step pill geometry: horizontal padding and border width (per side) that the
// measured label width must be padded by to size the pill.
const STEP_PILL_PAD_X = 10;
const STEP_PILL_BORDER = 1;
// The visible label is kept for this long after stepLabel goes null so the
// collapse animation still shows the text while the pill shrinks. Must stay
// above STEP_ROLL_MS (the width-transition beat) to cover the whole collapse.
const STEP_LABEL_GRACE_MS = 300;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// Content-driven textarea growth is capped at this (existing behavior). The
// manual resize ceiling is separate and lives in MANUAL_MAX_HEIGHT_*.
const AUTO_MAX_HEIGHT = 200;
// Manual resize floor: the composer's natural single-line height.
const MIN_MANUAL_HEIGHT_DESKTOP = 104;
const MIN_MANUAL_HEIGHT_MOBILE = 80;
// Manual resize ceiling: fixed cap plus a fraction of the viewport height.
const MANUAL_MAX_HEIGHT_CAP = 480;
const MANUAL_MAX_HEIGHT_FRACTION = 0.55;
const INPUT_HEIGHT_STORAGE_KEY = "pi-chat-input-height";
// Reading-mode collapse: after the user scrolls away from the bottom of the
// conversation, the composer shrinks to a single text row with the toolbar
// hidden, and expands again on return to the bottom or on focus. The intent
// window mirrors USER_SCROLL_INTENT_MS in useAgentSession so real user
// scrolling (wheel / touch / keyboard / scrollbar drag) stays distinguishable
// from programmatic scroll positioning.
const COMPACT_INTENT_MS = 1200;
const COMPACT_SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"]);
// Scroll-to-bottom affordance (floating row): appears only after the user has
// been continuously away from the bottom for this long, so it never flashes
// on brief scrolls.
const SCROLL_TO_BOTTOM_DELAY_MS = 8000;

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

function ThinkingLevelIcon({ level, size = 14 }: { level: ThinkingLevelOption; size?: number }) {
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

/**
 * The "/" command slot before the caret: the text up to the caret, trimmed
 * of leading whitespace (a space *before* the slash is tolerated), plus the
 * index of the slash itself. `caretPos === null` means the caret sits at the
 * end of the value (the default after programmatic edits). Shared by the
 * caret-based menu trigger and applySlashCommand.
 */
function getSlashSlot(value: string, caretPos: number | null) {
  const before = caretPos === null ? value : value.slice(0, caretPos);
  const trimmedBefore = before.trimStart();
  return {
    before,
    trimmedBefore,
    slashIndex: before.length - trimmedBefore.length,
  };
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

function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? []).map(draftImageToAttachedImage);
}

/**
 * True when the composer is empty enough to restore a historical message:
 * no draft text, no attached images, and no image reads still in flight.
 * The pending-image guard prevents clobbering an image the user just dropped
 * while its FileReader is still running.
 */
export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) => {
    if (block.type !== "image") return [];

    // Support both the current nested image format and older flat pi-ai entries.
    const flat = block as unknown as { data?: unknown; mimeType?: unknown };
    const data = block.source?.type === "base64" ? block.source.data : flat.data;
    const mimeType = block.source?.type === "base64" ? block.source.media_type : flat.mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string") return [];

    // Size/type guard expects the flat image shape (type + data + mimeType).
    const image = { type: "image" as const, data, mimeType };
    return isBase64ImageWithinLimits(image) ? [{ data, mimeType }] : [];
  });
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

// Pinned at the top of the model / thinking / tools dropdowns while the
// agent is running: config changes apply from the next turn, not to the
// response currently streaming.
function NextTurnBanner() {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 11, color: "var(--accent)", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
      <ClockIcon size={12} weight="bold" aria-hidden="true" />
      {t("desktop.configAppliesNextTurn")}
    </div>
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onBash, onAbort, onSteer, onFollowUp, isStreaming, isCompacting, onAbortCompaction, stepLabel, model, isAutoModelSelection, modelNames, modelList, imageInputByModel, modelScopeWarnings, onModelChange,
  compactResult, toolPreset, onToolPresetChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
  messagesScrollRef,
}: Props, ref) {
  const isMobile = useIsMobile();
  const { t } = useI18n();

  // Step pill: measure its natural width so the independent status button can
  // animate its width when the label appears, changes, or disappears. The
  // visible label is kept for a short grace period after stepLabel goes null
  // so the collapse animation still shows the text while it shrinks.
  const measureStepSpanRef = useRef<HTMLSpanElement | null>(null);
  const [stepLabelWidth, setStepLabelWidth] = useState(0);
  const [visibleStepLabel, setVisibleStepLabel] = useState<string | null>(null);
  useEffect(() => {
    if (stepLabel) {
      setVisibleStepLabel(stepLabel);
    } else {
      const timer = window.setTimeout(() => setVisibleStepLabel(null), STEP_LABEL_GRACE_MS);
      return () => window.clearTimeout(timer);
    }
  }, [stepLabel]);

  // Lyric-style vertical roll: when the step label changes, the old text
  // slides up out of the pill while the new text slides in from below. The
  // transition runs on the same stack element (transform 0 -> -STEP_LINE_H),
  // so a single state update kicks off the animation; the settle update that
  // drops the outgoing line runs with transition disabled to avoid a jump.
  const [stepRoll, setStepRoll] = useState<{ current: string | null; next: string | null; offset: number }>({ current: null, next: null, offset: 0 });
  const stepRollTimerRef = useRef<number | null>(null);
  const stepPillMaxWidth = isMobile ? 120 : 220;
  useEffect(() => {
    const label = visibleStepLabel;
    setStepRoll((prev) => {
      if (prev.current === label) return prev;
      if (label === null) return { current: null, next: null, offset: 0 };
      if (prev.current === null) return { current: label, next: null, offset: 0 };
      return { current: prev.current, next: label, offset: -STEP_LINE_H };
    });
    if (label === null) return;
    stepRollTimerRef.current = window.setTimeout(() => {
      stepRollTimerRef.current = null;
      setStepRoll((prev) => (prev.next ? { current: prev.next, next: null, offset: 0 } : prev));
    }, STEP_ROLL_MS);
    return () => {
      if (stepRollTimerRef.current !== null) window.clearTimeout(stepRollTimerRef.current);
    };
  }, [visibleStepLabel]);

  // The pill width settles on the *incoming* label so the width transition and
  // the lyric roll start and end together. A hidden, position:fixed span (out
  // of the width chain, so its measurement cannot feed back into the pill
  // width) reports the natural text width; clamp to the pill cap and add
  // padding + border (wrapper is border-box).
  useEffect(() => {
    const label = stepRoll.next ?? visibleStepLabel;
    if (!label) return;
    const el = measureStepSpanRef.current;
    if (!el) return;
    const width = Math.min(el.offsetWidth, stepPillMaxWidth - STEP_PILL_PAD_X * 2) + (STEP_PILL_PAD_X + STEP_PILL_BORDER) * 2;
    setStepLabelWidth((prev) => (Math.abs(prev - width) > 1 ? width : prev));
  }, [visibleStepLabel, stepRoll, stepPillMaxWidth]);
  // Thinking levels are model-facing identifiers shown as-is (English).
  const toolPresetLabels: Record<typeof TOOL_PRESETS[number], string> = {
    off: t("desktop.toolOff"),
    "read-only": t("desktop.toolReadOnly"),
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
  // Drafts are restored synchronously from the draft store so a remount
  // (every session switch remounts ChatWindow via key={sessionKey}) shows the
  // saved text immediately. The window guard keeps SSR deterministic (no
  // window → always empty); on the client the store is localStorage-backed
  // and returns the persisted draft. Restoring via effect is NOT safe: the
  // save effect would run on mount with the pre-restore empty value and
  // delete the persisted draft (isEmptyDraft removes the key) before the
  // restore effect re-reads it.
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return "";
    return draftKey ? getDraft(draftKey)?.value ?? "" : "";
  });
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
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachMenuRect, setAttachMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => {
    if (typeof window === "undefined") return [];
    return draftKey ? getDraft(draftKey)?.images.map(draftImageToAttachedImage) ?? [] : [];
  });
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  // Caret position used by the caret-based slash-menu trigger. null means the
  // caret is at the end of the value (the default after programmatic edits).
  const [slashCaretPos, setSlashCaretPos] = useState<number | null>(null);
  // Hover feedback only — never moves the keyboard selection.
  const [slashHoverIndex, setSlashHoverIndex] = useState<number | null>(null);
  const [skillDormancy, setSkillDormancy] = useState<Record<string, boolean>>({});
  const [inputShortcut, setInputShortcut] = useState<"enter" | "ctrl-enter">(() => {
    try {
      return localStorage.getItem("pi-input-shortcut") === "ctrl-enter" ? "ctrl-enter" : "enter";
    } catch { return "enter"; }
  });
  // Markdown list continuation on new lines (Settings → Chat toggle). Stored as
  // "on"/"off"; absent means enabled.
  const [markdownListContinue, setMarkdownListContinue] = useState(() => {
    try { return localStorage.getItem("pi-markdown-list-continue") !== "off"; } catch { return true; }
  });
  // Reading-mode collapse (Settings → Chat toggle). Stored as "on"/"off";
  // absent means enabled.
  const [compactInputEnabled, setCompactInputEnabled] = useState(() => {
    try { return localStorage.getItem("pi-compact-input") !== "off"; } catch { return true; }
  });
  const compactInputEnabledRef = useRef(compactInputEnabled);
  compactInputEnabledRef.current = compactInputEnabled;
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atHoverIndex, setAtHoverIndex] = useState<number | null>(null);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [historyHoverIndex, setHistoryHoverIndex] = useState<number | null>(null);
  // Measured space above the input area; caps the popup menus so they never
  // extend past the window's top edge. null until first measured.
  const [popupMaxHeight, setPopupMaxHeight] = useState<number | null>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  // Focus mirrored to a ref so the scroll handler (attached once, not on
  // every focus change) can refuse to collapse while the user types.
  const inputFocusedRef = useRef(false);
  // Timestamp until which a recent user scroll gesture counts as "user
  // intent" — programmatic scrolls never set this.
  const compactIntentUntilRef = useRef(0);
  // Previous scrollTop of the messages container, used to derive the user's
  // scroll direction from the scrollTop delta. The browser's clamp after a
  // collapse shows up as a negative delta ("up") — exactly what keeps the
  // state machine from re-expanding on its own height change.
  const lastScrollTopRef = useRef(0);
  // Scroll-to-bottom affordance: current at-bottom position and the pending
  // timer that reveals the floating button after SCROLL_TO_BOTTOM_DELAY_MS of
  // continuous absence from the bottom.
  const atBottomRef = useRef(true);
  const scrollToBottomTimerRef = useRef<number | null>(null);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);
  // Shared project-index / skill-name caches for mention highlighting (the
  // autocomplete menu keeps its own index state above — untouched).
  const fileIndexSnapshot = useFileIndex(cwd);
  const skillNames = useSkillNames(cwd);
  // Whether the composer textarea currently holds focus. Drives the
  // conditional visibility of the floating maximize/restore button above the
  // input box — it only appears while the user is typing-focused.
  const [inputFocused, setInputFocused] = useState(false);
  // Reading-mode collapse (desktop only): true while the user is scrolled
  // away from the bottom of the conversation and the composer is reduced to
  // a single text row. Reset on mount — every session switch (remount)
  // starts expanded.
  const [compact, setCompact] = useState(false);
  // Floating "scroll to bottom" button: visible only after the user has been
  // continuously away from the bottom for SCROLL_TO_BOTTOM_DELAY_MS.
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Scroll suppression: when the active index is clamped because the match
  // list shrank, do not scroll the list (it would jump mid-typing).
  const atSuppressScrollRef = useRef(false);
  const slashSuppressScrollRef = useRef(false);
  const historySuppressScrollRef = useRef(false);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;
  // Image FileReader reads still in flight — replaceMessage must not clobber
  // an image the user just dropped before its read finished.
  const pendingImageCountRef = useRef(0);

  // Highlight layer segments: valid @file mentions and /skill: commands get
  // accent + dotted underline styling in the backdrop behind the textarea.
  // The token under the @ autocomplete caret stays plain while being edited.
  const highlightSegments = useMemo(() => {
    const index = fileIndexSnapshot;
    const skills = skillNames;
    return tokenizeMentions(value, {
      fileExists: (path) => {
        if (!index) return undefined;
        const key = path.toLowerCase();
        return index.paths.has(key) || index.dirs.has(key);
      },
      isSkill: (name) => (skills ? skills.has(name) : undefined),
    }, atQuery?.start ?? null);
  }, [value, fileIndexSnapshot, skillNames, atQuery]);
  // The draft key whose state has been restored into the editor. The save
  // effect only writes once this matches draftKey, so a mount-time save can
  // never delete a persisted draft before the editor has been populated
  // (lazy initializer on mount, restore effect on key change).
  const draftRestoredRef = useRef<string | null>(null);
  // The editor content the restore effect last loaded from the store. The save
  // effect skips when the editor still matches this snapshot — the store
  // already holds exactly that content, so writing it again would be a no-op
  // at best and a data-loss hazard at worst: React StrictMode (dev, enabled by
  // default in Next App Router) re-runs mount effects, and a stale empty value
  // in the re-run would delete the draft before the restore effect re-reads it.
  const restoredSnapshotRef = useRef<{ value: string; imageCount: number } | null>(null);

  // Manual input-box height: drag the top border of the composer shell to
  // resize it (see .chat-input-resize-handle). `height` stays null in the
  // default content-driven mode and becomes a fixed pixel value once the
  // user takes manual control (drag, maximize toggle, or persisted value).
  const inputShellRef = useRef<HTMLDivElement>(null);
  const manualModeRef = useRef(false);
  const minManualHeight = isMobile ? MIN_MANUAL_HEIGHT_MOBILE : MIN_MANUAL_HEIGHT_DESKTOP;
  const getMaxManualHeight = useCallback(() => {
    if (typeof window === "undefined") return MANUAL_MAX_HEIGHT_CAP;
    return Math.max(
      minManualHeight,
      Math.min(MANUAL_MAX_HEIGHT_CAP, Math.floor(window.innerHeight * MANUAL_MAX_HEIGHT_FRACTION)),
    );
  }, [minManualHeight]);
  const inputHeightResizer = useResizableHeight({
    ariaLabel: t("desktop.resizeInput"),
    minHeight: minManualHeight,
    getMaxHeight: getMaxManualHeight,
    storageKey: INPUT_HEIGHT_STORAGE_KEY,
    targetRef: inputShellRef,
  });
  const manualHeight = inputHeightResizer.height;
  const manualMode = manualHeight !== null;
  manualModeRef.current = manualMode;

  // All content-driven textarea sizing funnels through this helper. In manual
  // mode the shell has a fixed height and the textarea fills it (flex stretch
  // + internal scroll), so auto-resizing must not fight the user's size.
  const applyAutoHeight = useCallback(() => {
    if (manualModeRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, AUTO_MAX_HEIGHT)}px`;
  }, []);

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
        applyAutoHeight();
      });
    },
    replaceMessage(message: UserMessage) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (!canRestoreUserMessage(current, attachedImagesRef.current.length, pendingImageCountRef.current)) return;

      setValue(getUserMessageText(message));
      setAtQuery(null);
      setHistoryMenuOpen(false);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return draftImagesToAttachedImages(getUserMessageDraftImages(message));
      });
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        applyAutoHeight();
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
        applyAutoHeight();
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
        applyAutoHeight();
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
    addFileMentions(files: File[]) {
      processFileMentions(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    try {
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
    } finally {
      pendingImageCountRef.current = Math.max(0, pendingImageCountRef.current - imageFiles.length);
    }
  }, []);

  /** Append `@relative/path ` mention tokens for dropped files. Cursor lands
   *  at the end of the input so the user can keep typing right away. */
  const insertFileMentionsAtEnd = useCallback((mentions: string[]) => {
    const text = buildFileAtMentionsText(mentions);
    if (!text) return;
    const ta = textareaRef.current;
    if (!ta) {
      setValue((v) => (v ? `${v} ${text}` : text));
      return;
    }
    const before = ta.value;
    const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
    const newVal = before + sep + text;
    setValue(newVal);
    setAtQuery(null);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(newVal.length, newVal.length);
      applyAutoHeight();
    });
  }, [applyAutoHeight]);

  /** Upload dropped files into the session cwd (plain-browser fallback and
   *  the "copy outside files into the project" path). Returns the uploaded
   *  file names, which are cwd-relative mention paths by construction. */
  const uploadFilesToCwd = useCallback(async (files: File[], targetCwd: string): Promise<string[]> => {
    const formData = new FormData();
    for (const f of files) formData.append("files", f);
    const response = await fetch(
      `/api/files/${encodeFilePathForApi(targetCwd)}?type=upload&conflict=error`,
      { method: "POST", body: formData },
    );
    const data = await response.json().catch(() => null) as
      | { uploaded?: string[]; errors?: Array<{ name: string; error: string }> }
      | null;
    if (!response.ok || !data) {
      throw new Error(data?.errors?.[0]?.error ?? `Upload failed (HTTP ${response.status})`);
    }
    if (data.errors && data.errors.length > 0) {
      throw new Error(data.errors.map((e) => `${e.name}: ${e.error}`).join("; "));
    }
    return data.uploaded ?? [];
  }, []);

  /** Turn dropped non-image files into @ mentions. Desktop resolves each
   *  File's absolute path via the Electron bridge and references in-project
   *  files in place (zero-copy); anything outside cwd is offered a copy into
   *  the project. Plain browsers have no path API, so files are uploaded into
   *  cwd first and then referenced by their uploaded name. */
  const processFileMentions = useCallback(async (files: File[]) => {
    if (isStreaming || !cwd) return;
    const getPathForFile = window.piDesktop?.getPathForFile;
    if (getPathForFile) {
      const absPaths = files.map((f) => getPathForFile(f)).filter((p): p is string => Boolean(p));
      if (!absPaths.length) return;
      const { mentions, rejected } = toCwdRelativeMentions(absPaths, cwd);
      if (mentions.length) insertFileMentionsAtEnd(mentions);
      if (!rejected.length) return;
      const outsideName = (p: string) => p.split(/[\\/]/).pop() ?? p;
      const copyOutside = window.confirm(
        rejected.length === 1
          ? t("desktop.dropOutsideProjectConfirm", { name: outsideName(rejected[0]) })
          : t("desktop.dropOutsideProjectConfirmMany", { count: rejected.length }),
      );
      if (!copyOutside) return;
      try {
        const uploaded = await uploadFilesToCwd(files, cwd);
        if (uploaded.length) insertFileMentionsAtEnd(uploaded);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    try {
      const uploaded = await uploadFilesToCwd(files, cwd);
      if (uploaded.length) insertFileMentionsAtEnd(uploaded);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [cwd, isStreaming, insertFileMentionsAtEnd, uploadFilesToCwd, t]);

  /** Insert "@" at the caret and open the @ file menu (shared by the Ctrl+I
   *  shortcut and the + toolbar menu's file entry). */
  const openAtCompletion = useCallback(() => {
    if (!cwd) return;
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const separator = before && !/[\s@]$/.test(before) ? " " : "";
    const nextValue = `${before}${separator}@${after}`;
    const cursor = before.length + separator.length + 1;
    setValue(nextValue);
    setAtQuery(extractAtQuery(nextValue.slice(0, cursor)));
    setAtMenuOpen(true);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }, [cwd, value]);

  /** Prefix the input with "/" so the existing slash-command menu opens
   *  (its trigger is derived from the value). Already-in-slash inputs are
   *  left alone. */
  const openSlashTrigger = useCallback(() => {
    const ta = textareaRef.current;
    const current = ta?.value ?? value;
    const trimmed = current.trimStart();
    if (trimmed.startsWith("/")) {
      requestAnimationFrame(() => { ta?.focus(); });
      return;
    }
    // Prefixed commands always open the menu: the slash becomes the first
    // non-whitespace character and the caret sits right after it, so the
    // caret-based trigger shows the full list. Existing text stays in the
    // input and is replaced if a command is selected — matching the typing
    // flow.
    setSlashCaretPos(1);
    setValue(`/${trimmed}`);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(1, 1);
      applyAutoHeight();
    });
  }, [value, applyAutoHeight]);

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
    if (!manualModeRef.current && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftRestoredRef.current !== draftKey) return;
    const snapshot = restoredSnapshotRef.current;
    const images = attachedImages.map(imageToDraftImage);
    // Skip while the editor still holds the restored content unchanged: the
    // store already has it. Any modification (typed text, cleared text,
    // added/removed images) takes over and saves immediately.
    if (snapshot && snapshot.value === value && snapshot.imageCount === images.length) return;
    restoredSnapshotRef.current = null;
    setDraft(draftKey, { value, images });
  }, [attachedImages, draftKey, value]);

  // Runs AFTER the save effect so the first save is deferred until this marks
  // the key as restored (draftRestoredRef). When the key changes, persist the
  // outgoing key's editor state and load the new key's draft into the editor.
  // On mount the lazy initializer already restored the draft, so only the
  // refs and restored snapshot are (re)set — the save effect relies on the
  // snapshot to skip writing back the unchanged content.
  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    const keyChanged = previousDraftKey !== draftKey;
    if (previousDraftKey && keyChanged && draftRestoredRef.current === previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    if (keyChanged) {
      setValue(draft?.value ?? "");
      setAtQuery(null);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return draft?.images.map(draftImageToAttachedImage) ?? [];
      });
    }
    draftKeyRef.current = draftKey;
    draftRestoredRef.current = draftKey ?? null;
    restoredSnapshotRef.current = draft
      ? { value: draft.value, imageCount: draft.images.length }
      : { value: "", imageCount: 0 };
  }, [draftKey]);

  useEffect(() => {
    applyAutoHeight();
  }, [applyAutoHeight, value]);

  // Mirror the textarea's internal scroll onto the highlight layer (auto
  // height cap / manual resize both make the textarea scroll). Also mirror
  // the textarea's content-box width: when the vertical scrollbar appears it
  // consumes ~4px inside the textarea, shrinking its wrap width — the
  // highlight layer (left:0/right:0) stays wider, so the caret (a textarea
  // artifact) wraps earlier than the visible glyphs (highlight-layer
  // artifacts) and drifts ahead of the text by ~half a cell per line. Runs
  // after every render so height changes settle before the offset is
  // recomputed.
  const syncHighlightScroll = useCallback(() => {
    const ta = textareaRef.current;
    const layer = highlightLayerRef.current;
    if (!ta || !layer) return;
    const offset = ta.scrollTop > 0 ? -ta.scrollTop : 0;
    layer.style.transform = offset ? `translateY(${offset}px)` : "";
    // clientWidth excludes the scrollbar gutter, so mirroring it keeps both
    // layers wrapping at the same columns in every state. Skip 0 (hidden
    // textarea) — the observer below re-syncs once it gets a size again.
    const width = ta.clientWidth;
    if (width > 0 && layer.style.width !== `${width}px`) {
      layer.style.width = `${width}px`;
    }
  }, []);
  useEffect(() => {
    syncHighlightScroll();
  });

  // The per-render sync covers typing, mode switches, and manual resizes,
  // but the scrollbar can appear/disappear (content growing past the auto
  // cap or the fixed shell height) or the window can resize without any
  // React render. A ResizeObserver on the textarea fires on those content-box
  // changes and re-syncs the highlight width + scroll offset.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const observer = new ResizeObserver(() => syncHighlightScroll());
    observer.observe(ta);
    return () => observer.disconnect();
  }, [syncHighlightScroll]);

  // Switching between auto and fixed manual height: fixed mode lets flex
  // stretch fill the shell (clear any stale inline height), auto mode
  // re-applies the content-driven height.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (manualMode) {
      ta.style.height = "";
    } else {
      applyAutoHeight();
    }
  }, [applyAutoHeight, manualMode]);

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
    const handler = () => {
      try { setMarkdownListContinue(localStorage.getItem("pi-markdown-list-continue") !== "off"); } catch { /* ignore */ }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      try { setCompactInputEnabled(localStorage.getItem("pi-compact-input") !== "off"); } catch { /* ignore */ }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Disabling the feature mid-read restores the composer immediately and
  // keeps it expanded until the setting is turned back on.
  useEffect(() => {
    if (!compactInputEnabled) setCompact(false);
  }, [compactInputEnabled]);

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

  // Slash menu trigger — caret-based, per the interaction rules:
  //   1. the slash is the first non-whitespace character of the input
  //      (mirrors the `!` bash mode and handleSend's trimmed routing),
  //   2. the caret sits right after the contiguous characters following "/",
  //   3. those characters (slash → caret) filter the menu,
  //   4. a space between the slash and the caret disables the menu.
  // Only the text before the caret matters, so pre-existing message text after
  // the caret never blocks the menu — and the caret is never obstructed.
  const { trimmedBefore } = getSlashSlot(value, slashCaretPos);
  const slashQuery = trimmedBefore.startsWith("/") && !/\s/.test(trimmedBefore.slice(1))
    ? trimmedBefore.slice(1).toLowerCase()
    : null;

  // Shared command pool for the slash menu and the ghost-text hint: builtins
  // are hidden while streaming (they cannot be invoked then), SDK commands
  // always apply.
  const slashCommandPool = [...(isStreaming ? [] : builtinSlashCommands), ...(slashCommands ?? [])];

  const matchedSlashCommands = (() => {
    if (slashQuery === null) return [];
    return [...slashCommandPool]
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

  // Ghost-text preview: while the caret-based slash slot holds an exact
  // command name and the caret sits at the end of the input, the matched
  // command's description is appended to the highlight layer as a faded
  // trailing hint. Rendered purely in the highlight layer, so the textarea
  // value never contains it — drafts and sent messages are unaffected.
  // Exact name match only (no prefix fallback): a partial command shows
  // nothing until it completes. Trailing whitespace after the command is
  // tolerated — the hint stays visible while the user spaces out before
  // typing arguments, and hides the moment a non-space character appears
  // after the name. The menu stays open alongside it; both are derived
  // from the same command pool.
  const slashGhost = (() => {
    const caret = slashCaretPos ?? value.length;
    if (caret !== value.length) return null;
    if (!trimmedBefore.startsWith("/") || trimmedBefore.length <= 1) return null;
    const body = trimmedBefore.slice(1);
    const spaceIdx = body.search(/\s/);
    const namePart = spaceIdx === -1 ? body : body.slice(0, spaceIdx);
    if (spaceIdx !== -1 && !/^\s+$/.test(body.slice(spaceIdx))) return null;
    const exact = slashCommandPool.find((command) => command.name.toLowerCase() === namePart.toLowerCase());
    const description = exact?.description?.trim();
    return description ? description : null;
  })();

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

  const hasInputText = Boolean(value.trim());
  // Popup height caps: once the space above the input is measured, it wins
  // over the static viewport-relative caps.
  const atMenuHeightCap = popupMaxHeight === null ? "min(calc(30vh / var(--app-ui-scale, 1)), 240px)" : Math.min(240, popupMaxHeight);
  const slashMenuHeightCap = popupMaxHeight === null ? "min(calc(38vh / var(--app-ui-scale, 1)), 300px)" : Math.min(300, popupMaxHeight);
  const canQueueStreamingMessage = hasInputText || attachedImages.length > 0;

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    // The slash-menu trigger is also caret-based (the text between the slash
    // and the caret filters the command list), so track the caret here — the
    // same event stream that feeds the @ file menu.
    setSlashCaretPos(cursor);
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
    setAtHoverIndex(null);
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
      applyAutoHeight();
    });
  }, [applyAutoHeight, atQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      atSuppressScrollRef.current = true;
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    if (atSuppressScrollRef.current) {
      atSuppressScrollRef.current = false;
      return;
    }
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
      applyAutoHeight();
    });
  }, [applyAutoHeight]);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    // Replace only the slash → caret command slot with `/${name} `; the
    // leading whitespace (allowed before the slash) and everything after the
    // caret (the user's message text) survive, so selecting a command never
    // wipes the rest of the input. The caret lands right after the inserted
    // command so further typing becomes its arguments. The menu can only be
    // open while a slash slot exists, so the slot is always present here.
    const caret = slashCaretPos ?? value.length;
    const { before, slashIndex } = getSlashSlot(value, slashCaretPos);
    const inserted = `/${command.name} `;
    const nextValue = `${before.slice(0, slashIndex)}${inserted}${value.slice(caret)}`;
    const nextCaret = slashIndex + inserted.length;
    setValue(nextValue);
    setSlashCaretPos(nextCaret);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextCaret, nextCaret);
      applyAutoHeight();
    });
  }, [value, slashCaretPos, applyAutoHeight]);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const msg = value.trim();
    // Images can be delivered mid-stream now (pi accepts them in steering /
    // follow-up prompts). Pass them through alongside the text; the action
    // buttons are gated by canQueueStreamingMessage.
    if (!msg && !attachedImages.length) return;
    const images = attachedImages.length ? attachedImages : undefined;
    onAudioUnlock?.();
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      onPromptWithStreamingBehavior(msg, streamingBehavior, images);
      clearInput();
      return;
    }
    if (mode === "steer" && onSteer) {
      onSteer(msg, images);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, images);
    }
    clearInput();
  }, [value, attachedImages, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock]);

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
        openAtCompletion();
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
        // Menu navigation is Up/Down only — Left/Right stay free so the caret
        // can move along the command text (the caret-based trigger re-filters
        // from the new position and closes once a space is crossed).
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex((i) => Math.min(Math.max(0, filteredSlashCommands.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex((i) => Math.max(0, i - 1));
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
        setHistoryHoverIndex(null);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@ menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      // Newline-intent Enters: plain Enter in ctrl-enter mode, or Shift+Enter
      // in any mode. When Markdown list continuation is on, re-emit the current
      // line's structural prefix instead of a bare newline (the menu and IME
      // branches above already took precedence).
      const isNewlineEnter = e.shiftKey
        || (inputShortcut === "ctrl-enter" && !(e.ctrlKey || e.metaKey));
      if (e.key === "Enter" && isNewlineEnter) {
        if (!isComposing && !recentlyComposed && markdownListContinue) {
          const ta = textareaRef.current;
          const start = ta?.selectionStart ?? value.length;
          const end = ta?.selectionEnd ?? start;
          const continuation = continueMarkdownList(value, start, end);
          if (continuation) {
            e.preventDefault();
            setValue(continuation.value);
            setSlashCaretPos(continuation.caret);
            setAtQuery(null);
            requestAnimationFrame(() => {
              const el = textareaRef.current;
              if (!el) return;
              el.focus();
              el.setSelectionRange(continuation.caret, continuation.caret);
              applyAutoHeight();
            });
            return;
          }
        }
        // No structural prefix: let the textarea handle the newline naturally.
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
    [isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, filteredSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, inputShortcut, markdownListContinue, cwd, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value, openAtCompletion, applyAutoHeight]
  );

  const handleInput = useCallback(() => {
    applyAutoHeight();
  }, [applyAutoHeight]);

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
      historySuppressScrollRef.current = true;
      setHistoryActiveIndex(Math.max(0, (inputHistory?.length ?? 0) - 1));
    }
  }, [historyActiveIndex, inputHistory]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory?.length ?? 0;
  }, [inputHistory]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    if (historySuppressScrollRef.current) {
      historySuppressScrollRef.current = false;
      return;
    }
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  // Cap the popup menus to the space above the input so they never poke past
  // the window's top edge. Re-measures while any menu is open: on window
  // resize, page scroll, and input-area size changes (auto-growing textarea).
  useEffect(() => {
    if (!atMenuOpen && !slashMenuOpen && !historyMenuOpen) return;
    const measure = () => {
      const el = inputAreaRef.current;
      if (!el) return;
      // Menus anchor 8px above the input area; keep a 4px breathing margin.
      // The cap's reference is the top edge of the messages area, so the
      // menus never cover the message list's header rows — not the window.
      const inputTop = el.getBoundingClientRect().top;
      const areaTop = messagesScrollRef?.current?.getBoundingClientRect().top ?? 0;
      // rect tops are physical under CSS zoom; the cap feeds a CSS maxHeight
      // that zoom paints at scale, so convert the distance before subtracting
      // the CSS margins.
      setPopupMaxHeight(Math.max(48, Math.round((inputTop - areaTop) / getUiScale() - 12)));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = new ResizeObserver(measure);
    if (inputAreaRef.current) observer.observe(inputAreaRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer.disconnect();
    };
  }, [atMenuOpen, slashMenuOpen, historyMenuOpen, messagesScrollRef]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    setSlashHoverIndex(null);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      slashSuppressScrollRef.current = true;
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    if (slashSuppressScrollRef.current) {
      slashSuppressScrollRef.current = false;
      return;
    }
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name, api: m.api })).sort(compareModelOptions);
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

  const currentModelOption = model
    ? modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)
    : undefined;
  const currentName = currentModelOption?.name ?? model?.modelId ?? null;

  // Image input is only available for models whose registry entry declares
  // `input` to include "image". Unknown models (not in the visible scope, or
  // before the models response arrives) default to supported so the attach
  // button is never blocked on missing data — only on a known lack of support.
  const modelSupportsImages = model
    ? (imageInputByModel?.[`${model.provider}:${model.modelId}`] ?? true)
    : true;
  const activeModelName = model
    ? (modelList?.find((m) => m.provider === model.provider && m.id === model.modelId)?.name
      ?? modelNames?.[`${model.provider}:${model.modelId}`]
      ?? model.modelId)
    : "";

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? `${t("desktop.compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} ${t("desktop.tokens")} (${formatTokenCount(compactSavedTokens)} ${t("desktop.saved")})`
    : null;
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return lvl;
    return thinkingLevelMap[lvl] ?? lvl;
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
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // The + attach menu opens from the toolbar button (not the textarea), so
  // Escape while it is open never reaches the textarea key handler.
  useEffect(() => {
    const escHandler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setAttachMenuOpen(false);
    };
    document.addEventListener("keydown", escHandler);
    return () => document.removeEventListener("keydown", escHandler);
  }, []);

  useEffect(() => {
    if (!isMobile) setControlsMenuOpen(false);
  }, [isMobile]);

  // Every time the model dropdown expands, focus the search input so the
  // user can start typing a filter immediately.
  useEffect(() => {
    if (modelDropdownOpen) modelSearchRef.current?.focus();
  }, [modelDropdownOpen]);

  // ── Reading-mode collapse (desktop only) ────────────────────────────────
  // A wheel / touch / keyboard / pointer gesture on or over the messages
  // container marks the next scroll events as user-intended, so programmatic
  // positioning (open-anchoring a running session, lazy-load prepends,
  // completion auto-scroll) can never collapse the input on its own.
  const markCompactScrollIntent = useCallback(() => {
    compactIntentUntilRef.current = Date.now() + COMPACT_INTENT_MS;
  }, []);

  // Recompute the compact state from the current scroll position. The
  // direction is derived from the scrollTop delta (see lastScrollTopRef);
  // ResizeObserver and initial evaluations pass "none". Edge-triggered on
  // the bottom boundary: entering the bottom expands only while scrolling
  // down, leaving it collapses only on a real upward user scroll — and never
  // while the textarea holds focus (requirement: focus always restores).
  // Also feeds the floating scroll-to-bottom button: it appears once the
  // user has been continuously away from the bottom for 8s, and hides the
  // moment they return (the timer is cancelled on any dip back to bottom).
  const updateCompactFromScroll = useCallback((direction: InputCompactScrollDirection = "none") => {
    const container = messagesScrollRef?.current ?? null;
    if (!container || isMobile) return;
    const remaining = scrollRemaining(container);
    const atBottom = remaining <= COMPACT_RESTORE_TRIGGER;
    if (atBottom !== atBottomRef.current) {
      atBottomRef.current = atBottom;
      if (atBottom) {
        if (scrollToBottomTimerRef.current !== null) {
          clearTimeout(scrollToBottomTimerRef.current);
          scrollToBottomTimerRef.current = null;
        }
        setShowScrollToBottom(false);
      } else {
        scrollToBottomTimerRef.current = window.setTimeout(() => {
          scrollToBottomTimerRef.current = null;
          setShowScrollToBottom(true);
        }, SCROLL_TO_BOTTOM_DELAY_MS);
      }
    }
    // Feature toggle (Settings → Chat): collapse only while enabled. The
    // scroll-to-bottom button tracking above stays active either way.
    if (inputFocusedRef.current || !compactInputEnabledRef.current) return;
    setCompact((prev) => nextInputCompactState(prev, {
      kind: "scroll",
      remaining,
      direction,
      userIntent: Date.now() < compactIntentUntilRef.current,
    }));
  }, [isMobile, messagesScrollRef]);

  // Smooth-scroll the conversation back to the bottom. The scroll events
  // that follow land the viewport at the bottom, which hides the button and
  // (being a downward scroll) restores the collapsed composer.
  const scrollToBottom = useCallback(() => {
    const container = messagesScrollRef?.current ?? null;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messagesScrollRef]);

  // Scroll listener: compute the direction from the movement since the last
  // event, then feed the state machine. The browser clamps scrollTop when the
  // collapse grows the container, producing a negative delta here — which is
  // what suppresses the immediate re-expand.
  const handleContainerScroll = useCallback(() => {
    const container = messagesScrollRef?.current ?? null;
    if (!container) return;
    const delta = container.scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = container.scrollTop;
    updateCompactFromScroll(delta > 0 ? "down" : delta < 0 ? "up" : "none");
  }, [messagesScrollRef, updateCompactFromScroll]);

  useEffect(() => {
    const container = messagesScrollRef?.current ?? null;
    if (!container || isMobile) return;
    lastScrollTopRef.current = container.scrollTop;
    container.addEventListener("scroll", handleContainerScroll, { passive: true });
    container.addEventListener("wheel", markCompactScrollIntent, { passive: true });
    container.addEventListener("touchstart", markCompactScrollIntent, { passive: true });
    container.addEventListener("pointerdown", markCompactScrollIntent, { passive: true });
    // Keyboard scrolling (focus outside a text field, e.g. on the messages)
    // is a user intent too.
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!COMPACT_SCROLL_KEYS.has(e.key)) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, [contenteditable='true']")) return;
      markCompactScrollIntent();
    };
    window.addEventListener("keydown", onKeyDown);
    // The container's height changes with the composer itself (collapse
    // enlarges the reading area, restore shrinks it) — re-evaluate the
    // bottom position so the state never goes stale. Direction "none" keeps
    // a collapse-induced evaluation from re-expanding the input.
    const observer = new ResizeObserver(() => updateCompactFromScroll("none"));
    observer.observe(container);
    // Initial evaluation: a session already positioned away from the bottom
    // (running session open-anchoring) carries no user intent, so the input
    // stays expanded until the user actually scrolls.
    updateCompactFromScroll("none");
    return () => {
      container.removeEventListener("scroll", handleContainerScroll);
      container.removeEventListener("wheel", markCompactScrollIntent);
      container.removeEventListener("touchstart", markCompactScrollIntent);
      container.removeEventListener("pointerdown", markCompactScrollIntent);
      window.removeEventListener("keydown", onKeyDown);
      observer.disconnect();
    };
  }, [isMobile, handleContainerScroll, markCompactScrollIntent, messagesScrollRef, updateCompactFromScroll]);

  // While compact, the CSS height clamp hides the textarea's real size; on
  // expand re-apply the content-driven height so a changed draft shows again
  // (no-op in manual height mode, where the shell owns the size).
  useEffect(() => {
    if (!compact) applyAutoHeight();
  }, [compact, applyAutoHeight]);

  // Cancel the pending scroll-to-bottom timer on unmount.
  useEffect(() => () => {
    if (scrollToBottomTimerRef.current !== null) {
      clearTimeout(scrollToBottomTimerRef.current);
      scrollToBottomTimerRef.current = null;
    }
  }, []);



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
        <div ref={inputAreaRef} style={{ position: "relative" }}>
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
                maxHeight: slashMenuHeightCap,
              }}
            >
              <div style={{ maxHeight: slashMenuHeightCap, overflowY: "auto", padding: 4 }}>
                {inputHistory.map((item, index) => (
                  <button
                    key={`${index}:${item}`}
                    ref={(node) => { historyItemRefs.current[index] = node; }}
                    type="button"
                    onMouseDown={(event) => { event.preventDefault(); applyHistoryInput(item); }}
                    onMouseEnter={() => setHistoryHoverIndex(index)}
                    onMouseLeave={() => setHistoryHoverIndex(null)}
                    style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 6px", border: "none", borderRadius: 5, background: index === historyActiveIndex ? "var(--bg-selected)" : historyHoverIndex === index ? "var(--bg-hover)" : "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left" }}
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
                maxHeight: slashMenuHeightCap,
              }}
            >
              <div style={{ maxHeight: slashMenuHeightCap, overflowY: "auto", padding: "6px 6px 8px" }}>
                {slashCommandsLoading ? (
                  <div style={{ padding: "2px 2px 2px", fontSize: 12, color: "var(--text-dim)" }}>
                    {t("desktop.loadingCommands")}
                  </div>
                ) : filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "2px 2px 2px", fontSize: 12, color: "var(--text-dim)" }}>
                    {t("desktop.noSlashCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group, groupIndex) => (
                    <section key={group.source} style={{ marginBottom: groupIndex === groupedSlashCommands.length - 1 ? 0 : 6 }}>
                      <div
                        style={{
                          position: "sticky",
                          top: -6,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "2px 6px 4px",
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
                              onMouseEnter={() => setSlashHoverIndex(index)}
                              onMouseLeave={() => setSlashHoverIndex(null)}
                              style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "3px 6px",
                                border: "none",
                                borderRadius: 5,
                                background: active ? "var(--bg-selected)" : slashHoverIndex === index ? "var(--bg-hover)" : "none",
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
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
              ? (atQuery.query ? t("desktop.searchingAllFiles") : t("desktop.indexTruncated"))
              : null;
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
                  maxHeight: atMenuHeightCap,
                }}
              >
                <div style={{ maxHeight: atMenuHeightCap, overflowY: "auto", padding: "6px 6px 8px" }}>
                  {indexLoading ? (
                    <div style={{ padding: "4px 6px", fontSize: 12, color: "var(--text-dim)" }}>
                      {t("desktop.loadingFiles")}
                    </div>
                  ) : atMatches.length === 0 ? (
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
                          onMouseEnter={() => setAtHoverIndex(index)}
                          onMouseLeave={() => setAtHoverIndex(null)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "3px 6px",
                            border: "none",
                            borderRadius: 5,
                            background: active ? "var(--bg-selected)" : atHoverIndex === index ? "var(--bg-hover)" : "none",
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
                  {truncatedHint && (
                    <div style={{ padding: "4px 6px 0", fontSize: 10, color: "var(--text-dim)" }}>
                      {truncatedHint}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          <div
            ref={inputShellRef}
            className={`chat-input-shell${isStreaming && (onSteer || onFollowUp) ? " is-streaming" : ""}${manualMode ? " is-manual-height" : ""}${compact ? " is-compact" : ""}`}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (!target.closest("button, input, select, [role=button], [role=separator]")) textareaRef.current?.focus();
            }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: 0,
              padding: 0,
              height: manualMode ? `${manualHeight}px` : undefined,
              transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
            } as React.CSSProperties}
          >
          {/* Drag handle on the top border — resize the composer vertically */}
          <div
            {...inputHeightResizer.separatorProps}
            className={`chat-input-resize-handle${inputHeightResizer.isResizing ? " is-resizing" : ""}`}
          />
          {isStreaming && <div className="chat-input-streaming-overlay hatch-45" aria-hidden="true" />}
          {/* Floating controls above the composer's top-right corner: the
              steer/follow-up group only appears while the agent runs; the
              maximize group appears only while the input box is focused.
              They stay visible in reading-mode collapse so the agent's live
              step pill keeps reporting while the user reads.
              Styled inline because Turbopack does not hot-reload globals.css
              in the Electron dev setup — inline tweaks ride the JS HMR instead. */}
          <div
            style={{
              position: "absolute",
              // Above the @/slash/history popups (z-index 120) and the resize
              // handle (3), below the fixed toolbar dropdowns (2000+).
              zIndex: 130,
              top: -22,
              right: isMobile ? 12 : 20,
              display: "flex",
              alignItems: "stretch",
              gap: 6,
            }}
          >
            {showScrollToBottom && (
              <div
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  overflow: "hidden",
                  border: "1px solid color-mix(in srgb, var(--border) 62%, transparent)",
                  borderRadius: 7,
                  background: "var(--bg-panel)",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.07)",
                }}
              >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={scrollToBottom}
                title={t("desktop.scrollToBottom")}
                aria-label={t("desktop.scrollToBottom")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 28, padding: 0,
                  border: 0,
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <ArrowDownIcon size={15} />
              </button>
              </div>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                overflow: "hidden",
                width: stepLabel ? stepLabelWidth : 0,
                opacity: stepLabel ? 1 : 0,
                marginRight: stepLabel ? 0 : -6,
                border: "1px solid color-mix(in srgb, var(--border) 62%, transparent)",
                borderRadius: 7,
                background: "var(--bg-panel)",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.07)",
                // Width animates on the same beat as the lyric roll and settles
                // directly on the incoming label's width (measured out-of-chain),
                // so both finish together and no trailing width animation runs
                // after the text switch.
                transition: `width ${STEP_ROLL_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease, margin-right ${STEP_ROLL_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
              }}
            >
              {visibleStepLabel && (
                <button
                  type="button"
                  title={visibleStepLabel}
                  aria-label={visibleStepLabel}
                  style={{
                    display: "flex", alignItems: "center",
                    flexShrink: 0,
                    width: "100%",
                    maxWidth: stepPillMaxWidth, height: STEP_LINE_H, padding: `0 ${STEP_PILL_PAD_X}px`,
                    border: 0,
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: "default",
                    fontSize: 12,
                    lineHeight: 1,
                  }}
                >
                  <div style={{ position: "relative", overflow: "hidden", height: STEP_LINE_H, width: "100%" }}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        transform: `translateY(${stepRoll.offset}px)`,
                        transition: stepRoll.next !== null
                          ? `transform ${STEP_ROLL_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
                          : "none",
                      }}
                    >
                      {stepRoll.current !== null && (
                        <span style={{ height: STEP_LINE_H, display: "flex", alignItems: "center", justifyContent: "flex-end", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {stepRoll.current}
                        </span>
                      )}
                      {stepRoll.next !== null && (
                        <span style={{ height: STEP_LINE_H, display: "flex", alignItems: "center", justifyContent: "flex-end", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {stepRoll.next}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )}
            </div>
            {/* Hidden, out-of-flow measuring span: reports the natural label
                width without being affected by the pill's animated width. */}
            <span
              ref={measureStepSpanRef}
              aria-hidden="true"
              style={{ position: "fixed", visibility: "hidden", pointerEvents: "none", whiteSpace: "nowrap", fontSize: 12, lineHeight: 1 }}
            >
              {stepRoll.next ?? visibleStepLabel ?? ""}
            </span>
            {(isStreaming && (onSteer || onFollowUp)) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  overflow: "hidden",
                  border: "1px solid color-mix(in srgb, var(--border) 62%, transparent)",
                  borderRadius: 7,
                  background: "var(--bg-panel)",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.07)",
                }}
              >
                {isStreaming && onSteer && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!canQueueStreamingMessage) return;
                      sendQueued("steer");
                    }}
                    // onMouseDown preventDefault keeps focus in the textarea so
                    // the maximize group (which is focus-gated and must stay
                    // collapsed with zero space while unfocused) does not unmount
                    // and shift the right-anchored actions row under the cursor.
                    // The button is intentionally NOT `disabled`: a disabled
                    // button swallows mouse events (no mousedown fires), so the
                    // blur could not be prevented and the maximize group would
                    // still collapse under the cursor. `aria-disabled` + the
                    // onClick guard below preserve the disabled semantics while
                    // keeping the pointer event path live.
                    onMouseDown={(e) => e.preventDefault()}
                    aria-disabled={!canQueueStreamingMessage}
                    tabIndex={canQueueStreamingMessage ? 0 : -1}
                    title={t("desktop.injectMessageNow")}
                    aria-label={t("desktop.steer")}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 36, height: 28, padding: 0,
                      border: 0,
                      background: "transparent",
                      color: canQueueStreamingMessage ? "var(--accent)" : "var(--text-dim)",
                      cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
                      opacity: canQueueStreamingMessage ? 1 : 0.55,
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (!canQueueStreamingMessage) return;
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = canQueueStreamingMessage ? "var(--accent)" : "var(--text-dim)";
                    }}
                  >
                    <ArrowElbowUpLeftIcon size={15} />
                  </button>
                )}
                {isStreaming && onFollowUp && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!canQueueStreamingMessage) return;
                      sendQueued("followup");
                    }}
                    // Same focus-preservation guard as the steer button above:
                    // never `disabled`, keeps the pointer event path live.
                    onMouseDown={(e) => e.preventDefault()}
                    aria-disabled={!canQueueStreamingMessage}
                    tabIndex={canQueueStreamingMessage ? 0 : -1}
                    title={t("desktop.queueMessageAfterFinish")}
                    aria-label={t("desktop.followUp")}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 36, height: 28, padding: 0,
                      border: 0,
                      borderLeft: "1px solid color-mix(in srgb, var(--border) 62%, transparent)",
                      background: "transparent",
                      color: canQueueStreamingMessage ? "var(--text-muted)" : "var(--text-dim)",
                      cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
                      opacity: canQueueStreamingMessage ? 1 : 0.55,
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (!canQueueStreamingMessage) return;
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = canQueueStreamingMessage ? "var(--text-muted)" : "var(--text-dim)";
                    }}
                  >
                    <SortDescendingIcon size={15} />
                  </button>
                )}
              </div>
            )}
            {inputFocused && (
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                overflow: "hidden",
                border: "1px solid color-mix(in srgb, var(--border) 62%, transparent)",
                borderRadius: 7,
                background: "var(--bg-panel)",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.07)",
              }}
            >
              {/* Maximize / restore the composer height to the manual ceiling.
                  onMouseDown preventDefault keeps focus in the textarea so blur
                  does not hide this button before the click registers. */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (manualHeight !== null) {
                    inputHeightResizer.resetHeight();
                  } else {
                    inputHeightResizer.setHeight(getMaxManualHeight());
                  }
                }}
                title={manualHeight !== null ? t("desktop.restoreInputHeight") : t("desktop.maximizeInput")}
                aria-label={manualHeight !== null ? t("desktop.restoreInputHeight") : t("desktop.maximizeInput")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 28, padding: 0,
                  border: 0,
                  background: "transparent",
                  color: manualHeight !== null ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = manualHeight !== null ? "var(--accent)" : "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = manualHeight !== null ? "var(--accent)" : "var(--text-muted)";
                }}
              >
                {manualHeight !== null ? <ArrowsInIcon size={15} /> : <ArrowsOutIcon size={15} />}
              </button>
            </div>
            )}
          </div>
          <div className="chat-input-editor-row" style={{ borderColor: bashMode ? "var(--tool-bg)" : undefined }}>
          {/* Highlight layer: same text, same metrics, positioned exactly over
              the textarea content box (editor row padding is 6px 12px). The
              textarea's own text is transparent so these tokens show through,
              with valid @file / /skill: mentions tinted accent + dotted. */}
          <div className="chat-input-highlight-viewport" aria-hidden="true">
            <div
              ref={highlightLayerRef}
              className="chat-input-highlight"
            >
              {highlightSegments.map((segment, i) =>
                segment.type === "text" || !segment.token.valid ? (
                  segment.text
                ) : (
                  <span key={i} className={`mention-token mention-token-${segment.token.kind}`}>{segment.text}</span>
                )
              )}
              {slashGhost && (
                <span aria-hidden="true" className="chat-input-ghost">{slashGhost}</span>
              )}
            </div>
          </div>
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
            onScroll={syncHighlightScroll}
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
            onFocus={() => { inputFocusedRef.current = true; setInputFocused(true); setCompact((prev) => nextInputCompactState(prev, { kind: "focus" })); }}
            onBlur={() => { inputFocusedRef.current = false; setInputFocused(false); }}
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
              // Transparent so the highlight layer beneath shows through. The
              // caret (caretColor) and the composing text stay visible: the
              // highlight layer renders the same `value` (React controlled
              // onChange fires during IME composition), so the composing pinyin
              // shows through in `var(--text)` while @file / /skill mention
              // highlights keep their accent tint. Painting the textarea text
              // solid here would cast an opaque layer over the highlight row —
              // hiding the mention highlights and double-drawing the glyphs
              // (a bolder, blurrier look) while composing.
              color: "transparent",
              caretColor: "var(--text)",
              // Positioned so it paints above the absolutely-positioned
              // highlight layer (both are positioned; DOM order wins).
              position: "relative",
              minHeight: manualMode ? 0 : 24,
              maxHeight: manualMode ? "none" : AUTO_MAX_HEIGHT,
              padding: 0,
              overflow: "hidden auto",
            }}
          />

          </div>

        {bashMode && !compact && (
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
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setAttachMenuRect({ top: cssPx(rect.top), left: cssPx(rect.left), width: cssPx(rect.width) });
                setAttachMenuOpen((v) => !v);
              }}
              title={t("desktop.attachContext")}
              aria-label={t("desktop.attachContext")}
              aria-expanded={attachMenuOpen}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, padding: 0,
                background: attachMenuOpen ? "var(--bg-hover)" : "none", border: "none",
                borderRadius: 6,
                color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = attachMenuOpen ? "var(--bg-hover)" : "none";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <PlusIcon size={14} />
            </button>
            {attachMenuOpen && attachMenuRect && (() => {
              const vh = cssPx(window.visualViewport?.height ?? window.innerHeight);
              const vw = cssPx(window.innerWidth);
              const menuWidth = 200;
              // Anchor like the other toolbar menus: bottom edge sits above
              // the button's top edge, left-aligned to the button.
              const l = Math.min(attachMenuRect.left, vw - menuWidth - 8);
              const b = vh - attachMenuRect.top + 4;
              return (
                <div ref={attachMenuRef} className="chat-input-menu-panel" style={{
                  position: "fixed", bottom: b, left: l,
                  zIndex: 2001, background: "var(--bg-panel)", border: "1px solid var(--border)",
                  borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                  overflow: "hidden", width: menuWidth,
                }}>
                  <div style={{ padding: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    <button
                      type="button"
                      onClick={() => { setAttachMenuOpen(false); openAtCompletion(); }}
                      disabled={!cwd}
                      title={cwd ? t("desktop.attachFileReference") : undefined}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        padding: "4px 10px", borderRadius: 4,
                        background: "none", border: "none",
                        color: cwd ? "var(--text)" : "var(--text-dim)",
                        cursor: cwd ? "pointer" : "not-allowed",
                        fontSize: 12, textAlign: "left",
                        opacity: cwd ? 1 : 0.6,
                        transition: "background 0.1s ease",
                      }}
                      onMouseEnter={(e) => { if (cwd) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <AtIcon size={14} weight="regular" aria-hidden="true" />
                      <span style={{ flex: 1 }}>{t("desktop.attachFileReference")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                      disabled={!modelSupportsImages}
                      title={!modelSupportsImages
                        ? t("desktop.attachImageModelUnsupported", { model: activeModelName })
                        : undefined}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        padding: "4px 10px", borderRadius: 4,
                        background: "none", border: "none",
                        color: modelSupportsImages ? "var(--text)" : "var(--text-dim)",
                        cursor: modelSupportsImages ? "pointer" : "not-allowed",
                        fontSize: 12, textAlign: "left",
                        opacity: modelSupportsImages ? 1 : 0.6,
                        transition: "background 0.1s ease",
                      }}
                      onMouseEnter={(e) => { if (modelSupportsImages) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <ImageIcon size={14} weight="regular" aria-hidden="true" />
                      <span style={{ flex: 1 }}>{t("desktop.attachImage")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAttachMenuOpen(false); openSlashTrigger(); }}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        padding: "4px 10px", borderRadius: 4,
                        background: "none", border: "none",
                        color: "var(--text)", cursor: "pointer",
                        fontSize: 12, textAlign: "left",
                        transition: "background 0.1s ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      <StarFourIcon size={14} weight="regular" aria-hidden="true" />
                      <span style={{ flex: 1 }}>{t("desktop.attachSkillCommand")}</span>
                    </button>
                  </div>
                </div>
              );
            })()}
            {onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} className="chat-input-toolbar-thinking" style={{ position: "relative" }}>
                <button
                  onClick={(e) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setThinkingDropdownRect({ top: cssPx(rect.top), left: cssPx(rect.left), width: cssPx(rect.width) }); setThinkingDropdownOpen((v) => !v); }}
                  title={isStreaming ? t("desktop.changeReasoningLevelWhileRunning", { level: thinkingDisplayLabel }) : t("desktop.changeReasoningLevel", { level: thinkingDisplayLabel })}
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
                    cursor: "pointer",
                    fontSize: 12,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                  }}
                >
                  <ThinkingLevelIcon level={thinkingLevel ?? "auto"} />
                  {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
                  {isStreaming && <ClockIcon size={11} weight="bold" color="var(--accent)" aria-hidden="true" />}
                  <CaretDownIcon
                    size={11}
                    weight="bold"
                    aria-hidden="true"
                    style={{ transform: thinkingDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s" }}
                  />
                </button>
                {thinkingDropdownOpen && thinkingDropdownRect && (() => {
                    const vh = cssPx(window.visualViewport?.height ?? window.innerHeight);
                    const vw = cssPx(window.innerWidth);
                    const panelMaxW = Math.min(240, vw - 16);
                    // Anchor the menu's bottom-right to the selector's top-right.
                    const l = Math.min(thinkingDropdownRect.left, vw - panelMaxW - 8);
                    const b = vh - thinkingDropdownRect.top + 4;
                    const maxH = Math.min(360, Math.max(120, Math.min(thinkingDropdownRect.top - 8, vh * 0.6)));
                    return (
                  <div className="chat-input-menu-panel" style={{
                    position: "fixed", bottom: b, left: l,
                    zIndex: 2001, background: "var(--bg-panel)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                    overflow: "hidden", minWidth: 200, maxWidth: panelMaxW, maxHeight: maxH, overflowY: "auto",
                  }}>
                    {isStreaming && <NextTurnBanner />}
                    <div style={{ padding: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    {filterThinkingLevelOptions(availableThinkingLevels).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "4px 10px",
                            borderRadius: 4,
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--accent)" : "var(--text)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontFamily: "var(--font-mono)",
                            whiteSpace: "nowrap",
                            transition: "background 0.1s ease",
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
                maxWidth: "calc(100vw / var(--app-ui-scale, 1) - 32px)",
                flexWrap: "nowrap",
                justifyContent: "flex-end",
                border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--bg-panel) 92%, var(--bg))",
                boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                backdropFilter: "blur(10px)",
              } : null),
            }}>
            {onToolPresetChange && (
              <div ref={toolDropdownRef} className="chat-input-toolbar-tools" style={{ position: "relative" }}>
                <button
                  onClick={(e) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setToolDropdownRect({ top: cssPx(rect.top), left: cssPx(rect.left), width: cssPx(rect.width) }); setToolDropdownOpen((v) => !v); }}
                  title={isStreaming ? t("desktop.changeToolPresetWhileRunning", { preset: toolPresetLabel }) : t("desktop.changeToolPreset", { preset: toolPresetLabel })}
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
                    cursor: "pointer",
                    fontSize: 12,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = toolDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  {(!isMobile || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{toolPresetLabel}</span>}
                  {isStreaming && <ClockIcon size={11} weight="bold" color="var(--accent)" aria-hidden="true" />}
                  <CaretDownIcon
                    size={11}
                    weight="bold"
                    aria-hidden="true"
                    style={{ transform: toolDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s" }}
                  />
                </button>
                {toolDropdownOpen && toolDropdownRect && (() => {
                    const vh = cssPx(window.visualViewport?.height ?? window.innerHeight);
                    const vw = cssPx(window.innerWidth);
                    const panelMaxW = Math.min(200, vw - 16);
                    // Anchor the menu's bottom-right corner to the selector's
                    // top-right corner. `right` preserves the alignment even
                    // when the menu width follows its content.
                    const r = Math.max(8, vw - (toolDropdownRect.left + toolDropdownRect.width));
                    const b = vh - toolDropdownRect.top + 6;
                    const maxH = Math.min(320, Math.max(100, Math.min(toolDropdownRect.top - 8, vh * 0.5)));
                    return (
                  <div className="chat-input-menu-panel" style={{
                    position: "fixed", bottom: b, right: r,
                    zIndex: 2001, background: "var(--bg-panel)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                    overflow: "hidden", minWidth: 120, maxWidth: panelMaxW, maxHeight: maxH, overflowY: "auto",
                  }}>
                    {isStreaming && <NextTurnBanner />}
                    <div style={{ padding: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "default") === preset;
                      const desc = lvl === "off" ? t("desktop.noTools") : lvl === "read-only" ? t("desktop.readOnlyBuiltInTools") : lvl === "default" ? t("desktop.fourBuiltInTools") : t("desktop.allBuiltInTools");
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "4px 10px",
                            borderRadius: 4,
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--accent)" : "var(--text)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontFamily: "var(--font-mono)",
                            whiteSpace: "nowrap",
                            transition: "background 0.1s ease",
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
                  </div>
                    );
                  })()}
              </div>
            )}

            {/* Model selector — always interactive; changes apply from the next turn while streaming */}
            {modelOptions.length > 0 && currentName && onModelChange && (
                <div ref={dropdownRef} className="chat-input-toolbar-model" style={{ position: "relative", flex: isMobile ? "1 1 auto" : undefined, minWidth: 0 }}>
                  <button
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: cssPx(rect.top), left: cssPx(rect.left), width: cssPx(rect.width) });
                      if (!modelDropdownOpen) setModelSearch("");
                      setModelDropdownOpen((v) => !v);
                    }}
                    title={isStreaming ? t("desktop.changeModelWhileRunning") : t("desktop.changeModel")}
                    aria-label={t("desktop.changeModel")}
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
                      cursor: "pointer",
                      fontSize: 12,
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = modelDropdownOpen ? "var(--bg-hover)" : "none";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    <ProviderIcon id={model?.provider ?? "unknown"} api={currentModelOption?.api} size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{currentName}</span>
                    {isStreaming && <ClockIcon size={11} weight="bold" color="var(--accent)" aria-hidden="true" />}
                    <CaretDownIcon
                      size={11}
                      weight="bold"
                      aria-hidden="true"
                      style={{ flexShrink: 0, transform: modelDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.12s" }}
                    />
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (() => {
                    const viewportHeight = cssPx(window.visualViewport?.height ?? window.innerHeight);
                    const viewportWidth = cssPx(window.innerWidth);
                    const bottom = viewportHeight - modelDropdownRect.top + 6;
                    const maxH = Math.min(400, Math.max(120, Math.min(modelDropdownRect.top - 8, viewportHeight * 0.6)));
                    // On mobile, pin to a small left margin and cap width to the
                    // viewport so long model names never push the panel off-screen.
                    // On desktop, clamp left so the panel stays within the viewport.
                    const panelMinWidth = modelDropdownRect.width;
                    const panelMaxWidth = Math.min(400, viewportWidth - 16);
                    const panelPos: React.CSSProperties = isMobile
                      ? { left: 8, right: 8, maxWidth: "calc(100vw / var(--app-ui-scale, 1) - 16px)" }
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
                      <div ref={modelDropdownPanelRef} className="chat-input-model-dropdown chat-input-menu-panel" style={{
                      position: "fixed",
                      bottom,
                      ...panelPos,
                      zIndex: 2000, background: "var(--bg-panel)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
                      overflow: "hidden", maxHeight: maxH,
                      display: "flex", flexDirection: "column",
                      }}>
                      {isStreaming && <NextTurnBanner />}
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
                          />
                        </div>
                      </div>
                      {/* Scrollable results */}
                      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                      {/* Favorites group — at top, always expanded */}
                      {hasFavs && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
                                style={{ display: "flex", alignItems: "center", margin: "0 4px" }}
                              >
                                <button
                                  onClick={() => { setModelDropdownOpen(false); if (!isActive || isAutoModelSelection) onModelChange(opt.provider, opt.modelId); }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    flex: 1, minWidth: 0,
                                    padding: "4px 8px",
                                    borderRadius: 4,
                                    background: isActive ? "var(--bg-selected)" : "none",
                                    border: "none",
                                    color: isActive ? "var(--accent)" : "var(--text)",
                                    cursor: "pointer", fontSize: 12, textAlign: "left",
                                    fontFamily: "var(--font-mono)",
                                    whiteSpace: "nowrap", overflow: "hidden",
                                    transition: "background 0.1s ease",
                                  }}
                                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                                >
                                  <ProviderIcon id={opt.provider} api={opt.api} size={14} />
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
                        <div key={group.provider} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <button
                            className="chat-input-menu-group-header"
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
                                style={{ display: "flex", alignItems: "center", margin: "0 4px" }}
                              >
                                <button
                                  onClick={() => { setModelDropdownOpen(false); if (!isActive || isAutoModelSelection) onModelChange(opt.provider, opt.modelId); }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    flex: 1, minWidth: 0,
                                    padding: "4px 8px",
                                    borderRadius: 4,
                                    background: isActive ? "var(--bg-selected)" : "none",
                                    border: "none",
                                    color: isActive ? "var(--accent)" : "var(--text)",
                                    cursor: "pointer", fontSize: 12, textAlign: "left",
                                    fontFamily: "var(--font-mono)",
                                    whiteSpace: "nowrap", overflow: "hidden",
                                    transition: "background 0.1s ease",
                                  }}
                                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                                >
                                  <ProviderIcon id={opt.provider} api={opt.api} size={14} />
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

            {!isStreaming && !isCompacting && (
              <button
                type="button"
                onClick={handleSend}
                disabled={!value.trim() && !attachedImages.length}
                className="chat-input-send"
                title={t("desktop.sendMessage")}
                aria-label={t("desktop.sendMessage")}
              >
                <PaperPlaneRightIcon size={14} />
              </button>
            )}

            {(isStreaming || isCompacting) && (
              <button
                onClick={isCompacting ? onAbortCompaction : onAbort}
                title={isCompacting ? t("desktop.stopCompaction") : t("desktop.stopAgent")}
                aria-label={isCompacting ? t("desktop.stopCompaction") : t("desktop.stopAgent")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 7px",
                  height: 24,
                  background: isCompacting
                    ? "color-mix(in srgb, var(--accent-orange) 14%, var(--bg-panel))"
                    : "color-mix(in srgb, var(--accent-red) 12%, var(--bg-panel))",
                  border: "none",
                  borderRadius: 6,
                  color: isCompacting ? "var(--accent-orange)" : "var(--accent-red)",
                  cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: "-0.01em",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = isCompacting
                  ? "color-mix(in srgb, var(--accent-orange) 24%, var(--bg-panel))"
                  : "color-mix(in srgb, var(--accent-red) 20%, var(--bg-panel))"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isCompacting
                  ? "color-mix(in srgb, var(--accent-orange) 14%, var(--bg-panel))"
                  : "color-mix(in srgb, var(--accent-red) 12%, var(--bg-panel))"; }}
              >
                <SquareIcon size={14} />
                {isCompacting ? t("desktop.stopCompaction") : t("desktop.stop")}
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
