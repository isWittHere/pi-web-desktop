"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useI18n } from "@/hooks/useI18n";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import type { CustomMessage, TextContent } from "@/lib/types";
import { MarkdownBody } from "./MarkdownBody";

interface CompactionSummaryProps {
  content: CustomMessage["content"];
}

function getSummaryText(content: CustomMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function CompactionSummary({ content }: CompactionSummaryProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const summary = getSummaryText(content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const fileContext = getFileContext(
    parsedSummary.readFiles.length,
    parsedSummary.modifiedFiles.length,
    t,
  );
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [showBottomShadow, setShowBottomShadow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const updateShadows = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setShowTopShadow(element.scrollTop > 0);
    setShowBottomShadow(element.scrollHeight - element.scrollTop - element.clientHeight > 1);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !expanded) return;
    const observer = new ResizeObserver(updateShadows);
    element.addEventListener("scroll", updateShadows, { passive: true });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    updateShadows();
    return () => {
      element.removeEventListener("scroll", updateShadows);
      observer.disconnect();
    };
  }, [expanded, updateShadows]);

  return (
    <div className="group/process relative mb-3 min-w-0">
      <div className="group/summary-row flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="group/summary flex min-w-0 items-center gap-1.5 text-left text-sm leading-relaxed text-text-muted transition-colors hover:text-text"
          aria-expanded={expanded}
        >
          <span className="truncate">{t("desktop.conversationCompacted")}</span>
          <span className={`opacity-0 transition-opacity group-hover/summary:opacity-60 ${expanded ? "rotate-90" : ""}`}>
            <CaretRightIcon size={12} className="shrink-0 transition-all duration-150" />
          </span>
        </button>
      </div>

      {expanded && (
        <div className="relative mt-2">
          <div ref={scrollRef} className="max-h-[280px] overflow-y-auto pr-2 text-text-dim">
            <p className="mb-2 text-xs leading-relaxed">{t("desktop.compactionSummaryDescription")}</p>
            {parsedSummary.body ? (
              <MarkdownBody className="!text-text-dim">{parsedSummary.body}</MarkdownBody>
            ) : (
              <span className="text-xs">{t("desktop.noSummary")}</span>
            )}
            {fileContext && (
              <div className="mt-3 border-t border-border pt-2 text-xs">
                <div className="font-medium">{t("desktop.fileContext", { context: fileContext })}</div>
                {parsedSummary.modifiedFiles.length > 0 && <FileList title={t("desktop.modifiedFiles")} files={parsedSummary.modifiedFiles} />}
                {parsedSummary.readFiles.length > 0 && <FileList title={t("desktop.readFiles")} files={parsedSummary.readFiles} />}
              </div>
            )}
          </div>
          {showTopShadow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-bg to-transparent" />}
          {showBottomShadow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-bg to-transparent" />}
        </div>
      )}
    </div>
  );
}

function getFileContext(
  readFileCount: number,
  modifiedFileCount: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  const parts: string[] = [];
  if (readFileCount > 0) parts.push(t("desktop.readFilesCount", { count: readFileCount }));
  if (modifiedFileCount > 0) parts.push(t("desktop.modifiedFilesCount", { count: modifiedFileCount }));
  return parts.length > 0 ? parts.join(", ") : null;
}

function FileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="mt-2">
      <div className="mb-1 font-mono text-[11px] font-medium text-text">{title}</div>
      <ul className="max-h-45 overflow-auto rounded-sm border border-border bg-bg-subtle px-2 py-1.5 font-mono text-[11px] leading-relaxed">
        {files.map((file) => (
          <li key={file} className="break-all">{file}</li>
        ))}
      </ul>
    </div>
  );
}
