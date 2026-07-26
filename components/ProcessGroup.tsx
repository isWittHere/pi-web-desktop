"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { MessageView, ThinkingBlock, ToolCallBlock } from "./MessageView";
import type { ProcessContentBlock } from "@/lib/process-content";
import type { ThinkingContent, ToolCallContent } from "@/lib/types";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { ColumnsIcon } from "@phosphor-icons/react/Columns";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { ListBulletsIcon } from "@phosphor-icons/react/ListBullets";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { PencilSimpleLineIcon } from "@phosphor-icons/react/PencilSimpleLine";
import { RowsIcon } from "@phosphor-icons/react/Rows";
import { TerminalIcon } from "@phosphor-icons/react/Terminal";
import { ToolboxIcon } from "@phosphor-icons/react/Toolbox";

interface ProcessGroupProps {
  blocks: ProcessContentBlock[];
  isStreaming: boolean;
  defaultExpanded?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
}

type Step =
  | { kind: "thinking"; id: string; label: string; blocks: Array<Extract<ProcessContentBlock, { type: "thinking" | "text" }>> }
  | { kind: "tool"; id: string; label: string; block: Extract<ProcessContentBlock, { type: "toolCall" }>; leadBlocks: Array<Extract<ProcessContentBlock, { type: "thinking" | "text" }>> }
  | { kind: "custom"; id: string; label: string; block: Extract<ProcessContentBlock, { type: "custom" }> }
  | { kind: "image"; id: string; label: string; block: Extract<ProcessContentBlock, { type: "image" }> };

function toolLabel(block: Extract<ProcessContentBlock, { type: "toolCall" }>): string {
  const label = block.input.label;
  return typeof label === "string" && label.trim() ? label : block.toolName;
}

export function buildProcessSteps(blocks: ProcessContentBlock[]): Step[] {
  const steps: Step[] = [];
  let pending: Array<Extract<ProcessContentBlock, { type: "thinking" | "text" }>> = [];

  const flushPending = () => {
    if (pending.length === 0) return;
    steps.push({
      kind: "thinking",
      id: pending.map((block) => block.id).join("+"),
      label: "Thinking",
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
      steps.push({
        kind: "tool",
        id: block.id,
        label: toolLabel(block),
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
      steps.push({ kind: "image", id: block.id, label: "Generated image", block });
    }
  }

  flushPending();
  return steps;
}

function formatCustomLabel(customType: string): string {
  return customType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function Caret({ expanded }: { expanded: boolean }) {
  return <CaretRightIcon size={12} className={`shrink-0 transition-all duration-150 ${expanded ? "rotate-90" : ""}`} />;
}

function StepIcon({ step }: { step: Step }) {
  if (step.kind === "thinking") return <BrainIcon size={14} />;
  if (step.kind === "image") return <ImageIcon size={14} />;
  if (step.kind === "custom") return <ListBulletsIcon size={14} />;

  const name = step.block.toolName.toLowerCase();
  if (/read|fetch|search|grep|find|list/.test(name)) return <MagnifyingGlassIcon size={14} />;
  if (/write|edit|patch|move|copy|delete/.test(name)) return <PencilSimpleLineIcon size={14} />;
  if (/terminal|bash|command|exec|shell/.test(name)) return <TerminalIcon size={14} />;
  return <ToolboxIcon size={14} />;
}

function DisplayModeIcon({ mode }: { mode: "timeline" | "tabs" }) {
  return mode === "timeline" ? <RowsIcon size={14} /> : <ColumnsIcon size={14} />;
}

function imageSource(block: Extract<ProcessContentBlock, { type: "image" }>): string | undefined {
  const source = block.source;
  if (source.type === "url") return source.url;
  if (!source.data) return undefined;
  return `data:${source.media_type ?? "image/png"};base64,${source.data}`;
}

function StepContent({ step, cwd, onOpenFile, sessionId }: {
  step: Step;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
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
  // Session images can be data URLs, which Next/Image does not optimize.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="Process output" className="max-h-72 max-w-full rounded border border-border object-contain" /> : null;
}

function ProcessNarrative({ blocks, cwd, onOpenFile, sessionId }: {
  blocks: Array<Extract<ProcessContentBlock, { type: "thinking" | "text" }>>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
}) {
  return (
    <div className="space-y-2 pr-2">
      {blocks.map((block) => block.type === "text" ? (
        <MarkdownBody key={block.id} cwd={cwd} onOpenFile={onOpenFile} className="!text-text-dim">{block.text}</MarkdownBody>
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
      ))}
    </div>
  );
}

function stepHasContent(step: Step): boolean {
  if (step.kind === "thinking") return step.blocks.some((block) => block.type === "text" ? block.text.trim() : block.deferred || block.thinking.trim());
  return true;
}

export function ProcessGroup({ blocks, isStreaming, defaultExpanded = false, cwd, onOpenFile, sessionId }: ProcessGroupProps) {
  const steps = useMemo(() => buildProcessSteps(blocks), [blocks]);
  const [areaExpanded, setAreaExpanded] = useState(isStreaming || defaultExpanded);
  const [stepStates, setStepStates] = useState<Record<string, boolean>>({});
  const [displayMode, setDisplayMode] = useState<"timeline" | "tabs">("timeline");
  const [activeTab, setActiveTab] = useState(0);
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [showBottomShadow, setShowBottomShadow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasStreamingRef = useRef(false);
  const previousLastStepIdRef = useRef<string | null>(null);

  useEffect(() => {
    const savedMode = window.localStorage.getItem("pi-process-display-mode");
    if (savedMode === "timeline" || savedMode === "tabs") setDisplayMode(savedMode);
  }, []);

  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
      setAreaExpanded(true);
      return;
    }
    if (!wasStreamingRef.current) return;
    setStepStates({});
    setActiveTab(0);
    previousLastStepIdRef.current = null;
    const timer = window.setTimeout(() => setAreaExpanded(false), 300);
    wasStreamingRef.current = false;
    return () => window.clearTimeout(timer);
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || steps.length === 0) return;
    const latest = steps[steps.length - 1];
    if (previousLastStepIdRef.current === latest.id) return;
    previousLastStepIdRef.current = latest.id;
    setActiveTab(steps.length - 1);
    setStepStates({ [latest.id]: true });
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
    updateShadows();
    return () => {
      element.removeEventListener("scroll", updateShadows);
      observer.disconnect();
    };
  }, [areaExpanded, displayMode, updateShadows]);

  useEffect(() => {
    if (!isStreaming || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    updateShadows();
  }, [blocks, isStreaming, updateShadows]);

  if (steps.length === 0) return null;

  const toolCount = steps.filter((step) => step.kind === "tool").length;
  const thoughtCount = blocks.filter((block) => block.type === "thinking" || block.type === "text").length;
  const customCount = steps.filter((step) => step.kind === "custom").length;
  const summaryParts: string[] = [];
  if (toolCount) summaryParts.push(`${toolCount} ${toolCount === 1 ? "tool" : "tools"}`);
  if (thoughtCount) summaryParts.push(`${thoughtCount} ${thoughtCount === 1 ? "thought" : "thoughts"}`);
  if (customCount) summaryParts.push(`${customCount} ${customCount === 1 ? "event" : "events"}`);
  const summary = isStreaming ? "Working..." : `Used ${summaryParts.join(" · ")}`;
  const singleThinking = steps.length === 1 && steps[0].kind === "thinking" && !isStreaming;

  return (
    <div className="group/process relative mb-3 min-w-0">
      <div className="group/summary-row flex items-center justify-between">
        <button
          type="button"
          onClick={() => setAreaExpanded((value) => !value)}
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
              window.localStorage.setItem("pi-process-display-mode", nextMode);
              setAreaExpanded(true);
            }}
            className="shrink-0 p-1 text-text-dim opacity-0 transition-colors hover:text-text group-hover/summary-row:opacity-100"
            title={displayMode === "timeline" ? "Tab mode" : "Timeline mode"}
          >
            <DisplayModeIcon mode={displayMode} />
          </button>
        )}
      </div>

      {areaExpanded && (
        <div className="overflow-hidden">
          {singleThinking ? (
            <div className="mt-2 max-h-[280px] overflow-y-auto pr-2">
              <StepContent step={steps[0]} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} />
            </div>
          ) : displayMode === "timeline" ? (
            <div className="relative">
              {showTopShadow && <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-bg to-transparent" />}
              {showBottomShadow && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-bg to-transparent" />}
              <div ref={scrollRef} className={isStreaming ? "max-h-[320px] overflow-y-auto" : ""}>
                <div className="relative ml-5 space-y-2">
                  <div className="absolute -left-3 -top-1.5 h-4 w-2 rounded-bl border-b border-l border-border" />
                  {steps.map((step, index) => {
                    const open = stepStates[step.id] ?? false;
                    const hasContent = stepHasContent(step);
                    return (
                      <div key={step.id} className="group/step relative min-w-0">
                        {index < steps.length - 1 && <span className="absolute bottom-[-9px] left-[7px] top-[22px] border-l border-border" />}
                        <button
                          type="button"
                          onClick={() => hasContent && setStepStates((state) => ({ ...state, [step.id]: !open }))}
                          className={`flex w-full min-w-0 items-center gap-1.5 text-left text-sm leading-relaxed text-text-dim transition-colors ${hasContent ? "cursor-pointer hover:text-text-muted" : "cursor-default"}`}
                        >
                          <span className="shrink-0"><StepIcon step={step} /></span>
                          <span className="truncate">{step.label}</span>
                          {step.kind === "tool" && step.block.duration !== undefined && (
                            <span className="shrink-0 text-[11px] tabular-nums text-text-dim">{step.block.duration}s</span>
                          )}
                          {step.kind === "tool" && step.block.status === "error" && (
                            <span className="shrink-0 text-[11px] text-red-400">failed</span>
                          )}
                          {hasContent && (
                            <span className={`ml-0.5 shrink-0 opacity-0 transition-opacity group-hover/step:opacity-50 ${open ? "rotate-90" : ""}`}>
                              <Caret expanded={false} />
                            </span>
                          )}
                        </button>
                        {open && hasContent && (
                          <div className="ml-5 mt-1.5 overflow-hidden">
                            <StepContent step={step} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} />
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
                {steps.map((step, index) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setActiveTab(index)}
                    className={`process-tab flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-xs transition-colors ${activeTab === index ? "process-tab-active border-border text-accent" : "border-border text-text-dim hover:text-text"}`}
                  >
                    <StepIcon step={step} />
                    <span className="max-w-52 truncate">{step.label}</span>
                  </button>
                ))}
              </div>
              <div ref={scrollRef} className="relative mt-2 max-h-[280px] overflow-y-auto pr-2">
                {steps[activeTab] && <StepContent step={steps[activeTab]} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} />}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
