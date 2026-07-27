"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { MessageView, ThinkingBlock, ToolCallBlock } from "./MessageView";
import { useLanguage } from "@/hooks/useLanguage";
import { useProcessDisplayMode } from "@/hooks/useProcessDisplayMode";
import type { ProcessContentBlock } from "@/lib/process-content";
import type { ThinkingContent, ToolCallContent } from "@/lib/types";
import type { StepTone } from "@/lib/step-categorizer";
import {
  classifyToolTone,
  classifyDocumentChangeKind,
  classifyShellCommand,
  extractToolTarget,
  basenameResourcePath,
} from "@/lib/step-categorizer";
import type { StepIconName } from "@/lib/step-visuals";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { BookOpenIcon } from "@phosphor-icons/react/BookOpen";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { ColumnsIcon } from "@phosphor-icons/react/Columns";
import { CopySimpleIcon } from "@phosphor-icons/react/CopySimple";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { FilePlusIcon } from "@phosphor-icons/react/FilePlus";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { ListBulletsIcon } from "@phosphor-icons/react/ListBullets";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PencilSimpleLineIcon } from "@phosphor-icons/react/PencilSimpleLine";
import { RowsIcon } from "@phosphor-icons/react/Rows";
import { TerminalIcon } from "@phosphor-icons/react/Terminal";
import { ToolboxIcon } from "@phosphor-icons/react/Toolbox";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { getFileIcon } from "./FileIcons";

interface ProcessGroupProps {
  blocks: ProcessContentBlock[];
  isStreaming: boolean;
  defaultExpanded?: boolean;
  onAutoExpanded?: () => void;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
}

type Step =
  | { kind: "thinking"; id: string; label: string; blocks: Array<Extract<ProcessContentBlock, { type: "thinking" | "text" }>> }
  | { kind: "tool"; id: string; label: string; block: Extract<ProcessContentBlock, { type: "toolCall" }>; leadBlocks: Array<Extract<ProcessContentBlock, { type: "thinking" | "text" }>> }
  | { kind: "custom"; id: string; label: string; block: Extract<ProcessContentBlock, { type: "custom" }> }
  | { kind: "image"; id: string; label: string; block: Extract<ProcessContentBlock, { type: "image" }> };

// ---------------------------------------------------------------------------
// Step labels (with tone enrichment)
// ---------------------------------------------------------------------------

function toolFallbackLabel(block: Extract<ProcessContentBlock, { type: "toolCall" }>): string {
  const label = block.input.label;
  return typeof label === "string" && label.trim() ? label : block.toolName;
}

type BuildLabelFn = (key: string) => string;

function enrichedToolLabel(
  block: Extract<ProcessContentBlock, { type: "toolCall" }>,
  ts: BuildLabelFn,
): { displayLabel: string; iconName: StepIconName; target?: string; tone?: StepTone; typeLabel?: string } {
  const fallback = toolFallbackLabel(block);
  const isError = block.status === "error";

  if (isError) {
    return { displayLabel: fallback, iconName: "warning", tone: undefined };
  }

  const tone = classifyToolTone({
    toolName: block.toolName,
    label: typeof block.input.label === "string" ? block.input.label : undefined,
    args: block.input,
    result: typeof block.result === "string" ? block.result : undefined,
  });

  let iconName: StepIconName = "toolbox";

  if (tone === "document_change") {
    const kind = classifyDocumentChangeKind({
      toolName: block.toolName,
      label: typeof block.input.label === "string" ? block.input.label : undefined,
      args: block.input,
      result: typeof block.result === "string" ? block.result : undefined,
    });
    if (kind === "create") iconName = "filePlus";
    else if (kind === "delete") iconName = "trash";
    else iconName = "pencilSimpleLine";

    const typeKey =
      kind === "create" ? "processStepFileCreate" :
      kind === "delete" ? "processStepFileDelete" :
      "processStepFileEdit";
    const typeLabel = ts(typeKey);

    const target = extractToolTarget({
      toolName: block.toolName,
      label: typeof block.input.label === "string" ? block.input.label : undefined,
      args: block.input,
      result: typeof block.result === "string" ? block.result : undefined,
    });

    if (target) {
      return { displayLabel: `${typeLabel} ${basenameResourcePath(target)}`, iconName, target, tone, typeLabel };
    }
    return { displayLabel: `${typeLabel}: ${fallback}`.slice(0, 100), iconName, tone, typeLabel };
  }

  if (tone === "document_read") {
    iconName = "bookOpen";
    const typeLabel = ts("processStepFileRead");
    const target = extractToolTarget({
      toolName: block.toolName,
      label: typeof block.input.label === "string" ? block.input.label : undefined,
      args: block.input,
      result: typeof block.result === "string" ? block.result : undefined,
    });
    if (target) {
      return { displayLabel: `${typeLabel} ${basenameResourcePath(target)}`, iconName, target, tone, typeLabel };
    }
    return { displayLabel: fallback, iconName, tone, typeLabel };
  }

  if (tone === "document_search") {
    iconName = "magnifyingGlass";
    const typeLabel = ts("processStepSearch");
    const pattern =
      typeof block.input.pattern === "string" ? block.input.pattern :
      typeof block.input.query === "string" ? block.input.query :
      "";
    if (pattern) {
      return { displayLabel: `${typeLabel} "${pattern.slice(0, 60)}"`, iconName, tone, typeLabel };
    }
    return { displayLabel: fallback, iconName, tone, typeLabel };
  }

  if (tone === "directory_list") {
    iconName = "folder";
    const typeLabel = ts("processStepList");
    const target = extractToolTarget({
      toolName: block.toolName,
      label: typeof block.input.label === "string" ? block.input.label : undefined,
      args: block.input,
      result: typeof block.result === "string" ? block.result : undefined,
    });
    if (target) {
      return { displayLabel: `${typeLabel} ${basenameResourcePath(target)}`, iconName, target, tone, typeLabel };
    }
    return { displayLabel: fallback, iconName, tone, typeLabel };
  }

  if (tone === "file_find") {
    iconName = "magnifyingGlass";
    const typeLabel = ts("processStepFind");
    const pattern =
      typeof block.input.pattern === "string" ? block.input.pattern :
      typeof block.input.glob === "string" ? block.input.glob :
      "";
    if (pattern) {
      return { displayLabel: `${typeLabel} "${pattern.slice(0, 60)}"`, iconName, tone, typeLabel };
    }
    return { displayLabel: fallback, iconName, tone, typeLabel };
  }

  if (tone === "command_execution") {
    const command = typeof block.input.command === "string"
      ? block.input.command
      : typeof block.input.cmd === "string"
        ? block.input.cmd
        : "";
    if (command) {
      const shell = classifyShellCommand(command);
      if (shell.kind === "list") {
        iconName = "folder";
        const typeLabel = ts("processStepList");
        const target = shell.argument ? ` ${shell.argument}` : "";
        return { displayLabel: `${typeLabel}${target}`, iconName, tone, typeLabel };
      }
      if (shell.kind === "search") {
        iconName = "magnifyingGlass";
        const typeLabel = ts("processStepSearch");
        const query = shell.argument ? ` "${shell.argument.slice(0, 60)}"` : "";
        return { displayLabel: `${typeLabel}${query}`, iconName, tone, typeLabel };
      }
      if (shell.kind === "find") {
        iconName = "magnifyingGlass";
        const typeLabel = ts("processStepFind");
        const query = shell.argument ? ` "${shell.argument.slice(0, 60)}"` : "";
        return { displayLabel: `${typeLabel}${query}`, iconName, tone, typeLabel };
      }
      if (shell.kind === "read") {
        iconName = "bookOpen";
        const typeLabel = ts("processStepRead");
        const target = shell.argument ? ` ${shell.argument}` : "";
        return { displayLabel: `${typeLabel}${target}`, iconName, tone, typeLabel, target: shell.argument || undefined };
      }
      if (shell.kind === "fetch") {
        iconName = "download";
        const typeLabel = ts("processStepFetch");
        const preview = shell.argument ? ` ${shell.argument.slice(0, 80)}` : "";
        return { displayLabel: `${typeLabel}${preview}`, iconName, tone, typeLabel };
      }
      if (shell.kind === "delete") {
        iconName = "trash";
        const typeLabel = ts("processStepDelete");
        const target = shell.argument ? ` ${shell.argument}` : "";
        return { displayLabel: `${typeLabel}${target}`, iconName, tone, typeLabel };
      }
      if (shell.kind === "copy") {
        iconName = "copy";
        const typeLabel = ts("processStepCopy");
        const target = shell.argument ? ` ${shell.argument}` : "";
        return { displayLabel: `${typeLabel}${target}`, iconName, tone, typeLabel };
      }
      iconName = "terminal";
      const typeLabel = ts("processStepCommand");
      const firstLine = command.split("\n")[0].trim();
      const preview = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
      return { displayLabel: `${typeLabel} ${preview}`, iconName, tone, typeLabel };
    }
    iconName = "terminal";
    return { displayLabel: fallback, iconName, tone };
  }

  if (tone === "todo_update") {
    iconName = "checklist";
    const typeLabel = ts("processStepTodo");
    return { displayLabel: fallback, iconName, tone, typeLabel };
  }

  return { displayLabel: fallback, iconName, tone };
}

// ---------------------------------------------------------------------------
// Build steps from blocks
// ---------------------------------------------------------------------------

export function buildProcessSteps(
  blocks: ProcessContentBlock[],
  ts: BuildLabelFn,
): Step[] {
  const steps: Step[] = [];
  let pending: Array<Extract<ProcessContentBlock, { type: "thinking" | "text" }>> = [];

  const flushPending = () => {
    if (pending.length === 0) return;
    steps.push({
      kind: "thinking",
      id: pending.map((block) => block.id).join("+"),
      label: ts("processStepThinking"),
      blocks: pending,
    });
    pending = [];
  };

  for (const block of blocks) {
    if (block.type === "thinking" || block.type === "text") {
      pending.push(block);
      continue;
    }
    if (block.type === "toolCall") {
      const { displayLabel } = enrichedToolLabel(block, ts);
      steps.push({
        kind: "tool",
        id: block.id,
        label: displayLabel,
        block,
        leadBlocks: pending,
      });
      pending = [];
      continue;
    }

    flushPending();
    if (block.type === "custom") {
      steps.push({ kind: "custom", id: block.id, label: formatCustomLabel(block.customType), block });
    } else if (block.type === "image") {
      steps.push({ kind: "image", id: block.id, label: ts("processOutput"), block });
    }
  }

  flushPending();
  return steps;
}

function thinkingDuration(step: Step): number | undefined {
  if (step.kind !== "thinking") return undefined;
  let total: number | undefined;
  for (const b of step.blocks) {
    if (b.type === "thinking" && typeof b.duration === "number") {
      total = (total ?? 0) + b.duration;
    }
  }
  return total;
}

function formatCustomLabel(customType: string): string {
  return customType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function Caret({ expanded }: { expanded: boolean }) {
  return <CaretRightIcon size={12} className={`shrink-0 transition-all duration-150 ${expanded ? "rotate-90" : ""}`} />;
}

function stepIconElement(iconName: StepIconName, size: number = 14) {
  switch (iconName) {
    case "brain": return <BrainIcon size={size} />;
    case "bookOpen": return <BookOpenIcon size={size} />;
    case "magnifyingGlass": return <MagnifyingGlassIcon size={size} />;
    case "pencilSimpleLine": return <PencilSimpleLineIcon size={size} />;
    case "filePlus": return <FilePlusIcon size={size} />;
    case "trash": return <TrashIcon size={size} />;
    case "folder": return <FolderIcon size={size} />;
    case "download": return <DownloadSimpleIcon size={size} />;
    case "copy": return <CopySimpleIcon size={size} />;
    case "terminal": return <TerminalIcon size={size} />;
    case "toolbox": return <ToolboxIcon size={size} />;
    case "image": return <ImageIcon size={size} />;
    case "listBullets": return <ListBulletsIcon size={size} />;
    case "checklist": return <ListBulletsIcon size={size} />;
    case "warning":
    case "circleX": return <WarningCircleIcon size={size} />;
    default: return <ToolboxIcon size={size} />;
  }
}

function StepIcon({ step, ts }: { step: Step; ts: BuildLabelFn }) {
  if (step.kind === "thinking") return stepIconElement("brain");
  if (step.kind === "image") return stepIconElement("image");
  if (step.kind === "custom") return stepIconElement("listBullets");

  const { iconName } = enrichedToolLabel(step.block, ts);
  return stepIconElement(iconName);
}

function ProcessFileTag({ filePath }: { filePath: string }) {
  const basename = filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
  return (
    <span className="process-file-tag" title={filePath}>
      {getFileIcon(filePath, 12)}
      <span>{basename}</span>
    </span>
  );
}

function DisplayModeIcon({ mode }: { mode: "timeline" | "tabs" }) {
  return mode === "timeline" ? <RowsIcon size={14} /> : <ColumnsIcon size={14} />;
}

// ---------------------------------------------------------------------------
// Step content rendering
// ---------------------------------------------------------------------------

function imageSource(block: Extract<ProcessContentBlock, { type: "image" }>): string | undefined {
  const source = block.source;
  if (source.type === "url") return source.url;
  if (!source.data) return undefined;
  return `data:${source.media_type ?? "image/png"};base64,${source.data}`;
}

function StepContent({ step, cwd, onOpenFile, sessionId, ts }: {
  step: Step;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
  ts: BuildLabelFn;
}) {
  if (step.kind === "thinking") {
    return <ProcessNarrative blocks={step.blocks} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} />;
  }
  if (step.kind === "tool") {
    return (
      <div className="space-y-2">
        {step.leadBlocks.length > 0 && (
          <ProcessNarrative blocks={step.leadBlocks} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} />
        )}
        <ToolCallBlock
          block={{
            type: "toolCall",
            toolCallId: step.block.toolCallId,
            toolName: step.block.toolName,
            input: step.block.input,
          } as ToolCallContent}
          result={step.block.result}
          duration={step.block.duration}
          processStyle
        />
      </div>
    );
  }
  if (step.kind === "custom") {
    return <MessageView message={step.block.message} cwd={cwd} onOpenFile={onOpenFile} />;
  }

  const src = imageSource(step.block);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={ts("processOutput")} className="max-h-72 max-w-full rounded border border-border object-contain" />
  ) : null;
}

function ProcessNarrative({ blocks, cwd, onOpenFile, sessionId }: {
  blocks: Array<Extract<ProcessContentBlock, { type: "thinking" | "text" }>>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
}) {
  return (
    <div className="space-y-2 pr-2">
      {blocks.map((block) =>
        block.type === "text" ? (
          <MarkdownBody key={block.id} cwd={cwd} onOpenFile={onOpenFile} className="!text-text-dim">
            {block.text}
          </MarkdownBody>
        ) : (
          <ThinkingBlock
            key={block.id}
            block={{ type: "thinking", thinking: block.thinking, deferred: block.deferred } as ThinkingContent}
            sessionId={sessionId}
            entryId={block.origin.sourceEntryId}
            blockIndex={block.origin.sourceBlockIndex ?? 0}
            contentOnly
            cwd={cwd}
            onOpenFile={onOpenFile}
            className="!text-text-dim"
          />
        ),
      )}
    </div>
  );
}

function stepHasContent(step: Step): boolean {
  if (step.kind === "thinking") {
    return step.blocks.some((b) =>
      b.type === "text" ? b.text.trim().length > 0 : b.deferred || b.thinking.trim().length > 0,
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// ProcessGroup
// ---------------------------------------------------------------------------

export function ProcessGroup({
  blocks,
  isStreaming,
  defaultExpanded = false,
  onAutoExpanded,
  cwd,
  onOpenFile,
  sessionId,
}: ProcessGroupProps) {
  const { t } = useLanguage();
  const ts: BuildLabelFn = useCallback((key: string) => t(key as Parameters<typeof t>[0]), [t]);
  const steps = useMemo(() => buildProcessSteps(blocks, ts), [blocks, ts]);
  const [areaExpanded, setAreaExpanded] = useState(isStreaming || defaultExpanded);
  const [stepStates, setStepStates] = useState<Record<string, boolean>>({});
  const { displayMode, setDisplayMode } = useProcessDisplayMode();
  const [activeTab, setActiveTab] = useState(0);
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [showBottomShadow, setShowBottomShadow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasStreamingRef = useRef(false);
  const hasUserSelectedTabRef = useRef(false);
  const hasAppliedDefaultExpansionRef = useRef(false);

  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
      setAreaExpanded(true);
      return;
    }
    if (!wasStreamingRef.current) return;
    setStepStates({});
    const timer = window.setTimeout(() => setAreaExpanded(false), 300);
    wasStreamingRef.current = false;
    return () => window.clearTimeout(timer);
  }, [isStreaming]);

  useEffect(() => {
    if (defaultExpanded && !isStreaming && !hasAppliedDefaultExpansionRef.current && steps.length > 0) {
      const latest = steps[steps.length - 1];
      hasAppliedDefaultExpansionRef.current = true;
      setStepStates({ [latest.id]: true });
      window.requestAnimationFrame(() => onAutoExpanded?.());
    }
  }, [defaultExpanded, isStreaming, onAutoExpanded, steps]);

  useEffect(() => {
    if (steps.length === 0) return;
    const latest = steps[steps.length - 1];
    setActiveTab((currentTab) => {
      if (hasUserSelectedTabRef.current && currentTab < steps.length) return currentTab;
      return steps.length - 1;
    });
    if (isStreaming) setStepStates({ [latest.id]: true });
  }, [isStreaming, steps]);

  const updateShadows = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setShowTopShadow(element.scrollTop > 0);
    setShowBottomShadow(element.scrollHeight - element.scrollTop - element.clientHeight > 1);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !areaExpanded) return;
    const observer = new ResizeObserver(updateShadows);
    element.addEventListener("scroll", updateShadows, { passive: true });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    updateShadows();
    return () => {
      element.removeEventListener("scroll", updateShadows);
      observer.disconnect();
    };
  }, [activeTab, areaExpanded, displayMode, isStreaming, stepStates, steps.length, updateShadows]);

  useEffect(() => {
    if (!isStreaming || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    updateShadows();
  }, [blocks, isStreaming, updateShadows]);

  if (steps.length === 0) return null;

  const toolCount = steps.filter((s) => s.kind === "tool").length;
  const failedCount = steps.filter((s) => s.kind === "tool" && s.block.status === "error").length;
  const thoughtCount = blocks.filter((b) => b.type === "thinking" || b.type === "text").length;
  const customCount = steps.filter((s) => s.kind === "custom").length;

  const singleThinking = steps.length === 1 && steps[0].kind === "thinking" && !isStreaming;
  const singleTool = steps.length === 1 && steps[0].kind === "tool" && !isStreaming;

  let summary: string;
  if (isStreaming) {
    summary = t("processWorking");
  } else if (singleThinking) {
    const d = thinkingDuration(steps[0]);
    summary = d !== undefined
      ? t("processThoughtDone").replace("{duration}", String(d))
      : t("processThoughtDoneNoDuration");
  } else if (singleTool) {
    const step = steps[0] as Extract<Step, { kind: "tool" }>;
    const tool = step.block;
    const enriched = enrichedToolLabel(tool, ts);
    const d = tool.duration;
    summary = d !== undefined ? `${enriched.displayLabel} ${d}s` : enriched.displayLabel;
  } else {
    const summaryParts: string[] = [];
    if (toolCount) {
      const base = toolCount === 1
        ? t("processToolCount").replace("{count}", String(toolCount))
        : t("processToolsCount").replace("{count}", String(toolCount));
      summaryParts.push(failedCount > 0
        ? base + t("processFailedCount").replace("{failed}", String(failedCount))
        : base);
    }
    if (thoughtCount) {
      summaryParts.push(
        (thoughtCount === 1 ? t("processThoughtCount") : t("processThoughtsCount")).replace("{count}", String(thoughtCount)),
      );
    }
    if (customCount) {
      summaryParts.push(
        (customCount === 1 ? t("processCustomCount") : t("processCustomsCount")).replace("{count}", String(customCount)),
      );
    }
    summary = summaryParts.length > 0
      ? t("processUsed").replace("{summary}", summaryParts.join(" · "))
      : t("processCompleted");
  }

  return (
    <div className="group/process relative mb-3 min-w-0">
      <div className="group/summary-row flex items-center justify-between">
        <button
          type="button"
          onClick={() => setAreaExpanded((v) => !v)}
          className="group/summary flex min-w-0 items-center gap-1.5 text-left text-sm leading-relaxed text-text-muted transition-colors hover:text-text"
          aria-expanded={areaExpanded}
        >
          <span className="truncate">{summary}</span>
          <span className={`opacity-0 transition-opacity group-hover/summary:opacity-60 ${areaExpanded ? "rotate-90" : ""}`}>
            <Caret expanded={false} />
          </span>
        </button>
        {!singleThinking && (
          <button
            type="button"
            onClick={() => {
              const nextMode = displayMode === "timeline" ? "tabs" : "timeline";
              setDisplayMode(nextMode);
              setAreaExpanded(true);
            }}
            className="shrink-0 p-1 text-text-dim opacity-0 transition-colors hover:text-text group-hover/summary-row:opacity-100"
            title={displayMode === "timeline" ? t("processTabMode") : t("processTimelineMode")}
          >
            <DisplayModeIcon mode={displayMode} />
          </button>
        )}
      </div>

      {areaExpanded && (
        <div className="overflow-hidden">
          {singleThinking ? (
            <div className="relative mt-2">
              <div ref={scrollRef} className="max-h-[280px] overflow-y-auto pr-2">
                <StepContent step={steps[0]} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} ts={ts} />
              </div>
              {showTopShadow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-bg to-transparent" />}
              {showBottomShadow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-bg to-transparent" />}
            </div>
          ) : displayMode === "timeline" ? (
            <div className="relative mt-2">
              {showTopShadow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-bg to-transparent" />}
              {showBottomShadow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-bg to-transparent" />}
              <div ref={scrollRef} className={isStreaming ? "max-h-[320px] overflow-y-auto" : ""}>
                <div className="relative ml-5 space-y-2">
                  <div className="absolute -left-3 -top-1.5 h-4 w-2 rounded-bl border-b border-l border-border" />
                  {steps.map((step, index) => {
                    const open = stepStates[step.id] ?? false;
                    const hasContent = stepHasContent(step);
                    const isError = step.kind === "tool" && step.block.status === "error";
                    const toolInfo = step.kind === "tool" ? enrichedToolLabel(step.block, ts) : null;
                    const hasFileTag = toolInfo?.target !== undefined && toolInfo?.typeLabel !== undefined;
                    return (
                      <div key={step.id} className="group/step relative min-w-0">
                        {index < steps.length - 1 && <span className="absolute bottom-[-9px] left-[7px] top-[22px] border-l border-border" />}
                        <button
                          type="button"
                          onClick={() => hasContent && setStepStates((state) => ({ ...state, [step.id]: !open }))}
                          className={`flex w-full min-w-0 items-center gap-1.5 text-left text-sm leading-relaxed transition-colors ${
                            hasContent ? "cursor-pointer" : "cursor-default"
                          } ${isError ? "text-red-400 hover:text-red-300" : "text-text-dim hover:text-text-muted"}`}
                        >
                          <span className="shrink-0"><StepIcon step={step} ts={ts} /></span>
                          {hasFileTag ? (
                            <>
                              <span className="shrink-0">{toolInfo!.typeLabel}</span>
                              <ProcessFileTag filePath={toolInfo!.target!} />
                            </>
                          ) : (
                            <span className="truncate">{step.label}</span>
                          )}
                          {step.kind === "tool" && step.block.duration !== undefined && (
                            <span className="shrink-0 text-[11px] tabular-nums text-text-dim">{step.block.duration}s</span>
                          )}
                          {isError && (
                            <span className="shrink-0 text-[11px] font-medium text-red-400">{t("processFailedStep")}</span>
                          )}
                          {hasContent && (
                            <span className={`ml-0.5 shrink-0 opacity-0 transition-opacity group-hover/step:opacity-50 ${open ? "rotate-90" : ""}`}>
                              <Caret expanded={false} />
                            </span>
                          )}
                        </button>
                        {open && hasContent && (
                          <div className="ml-5 mt-1.5 overflow-hidden">
                            <StepContent step={step} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} ts={ts} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="mt-2 flex flex-wrap gap-1">
                {steps.map((step, index) => {
                  const isError = step.kind === "tool" && step.block.status === "error";
                  const toolInfo = step.kind === "tool" ? enrichedToolLabel(step.block, ts) : null;
                  const hasFileTag = toolInfo?.target !== undefined && toolInfo?.typeLabel !== undefined;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => {
                        hasUserSelectedTabRef.current = true;
                        setActiveTab(index);
                      }}
                      data-has-file-target={hasFileTag ? "true" : undefined}
                      className={`process-tab flex items-center gap-1 font-mono text-xs transition-colors ${
                        activeTab === index
                          ? isError
                            ? "process-tab-error"
                            : "process-tab-active"
                          : "text-text-dim hover:text-text"
                      }`}
                    >
                      <StepIcon step={step} ts={ts} />
                      {hasFileTag ? (
                        <>
                          <span className="shrink-0">{toolInfo!.typeLabel}</span>
                          <ProcessFileTag filePath={toolInfo!.target!} />
                        </>
                      ) : (
                        <span className="max-w-52 truncate">{step.label}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="relative mt-2">
                <div ref={scrollRef} className="max-h-[280px] overflow-y-auto pr-2">
                  {steps[activeTab] && <StepContent step={steps[activeTab]} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} ts={ts} />}
                </div>
                {showTopShadow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-bg to-transparent" />}
                {showBottomShadow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-bg to-transparent" />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
