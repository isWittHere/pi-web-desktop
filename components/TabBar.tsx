"use client";

import { useRef, useState } from "react";
import { GitDiff, GitMerge, X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { getFileIcon } from "./FileIcons";
import { isFileTab, type Tab } from "./tab-model";

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement | null>());

  const handleTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextId = tabs[nextIndex].id;
    onSelectTab(nextId);
    tabRefs.current.get(nextId)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t("desktop.panelTabs")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "0 6px",
        background: "var(--bg-panel)",
        overflowX: "auto",
        flexShrink: 0,
        height: 36,
        scrollbarWidth: "none",
      }}
      className="right-panel-tab-strip"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isHovered = tab.id === hoveredTab;
        const label = isFileTab(tab) ? tab.label : tab.kind === "changes" ? t("desktop.changesTab") : t("desktop.gitGraphTab");
        const icon = isFileTab(tab)
          ? getFileIcon(tab.label, 13)
          : tab.kind === "changes"
            ? <GitDiff size={13} aria-hidden="true" />
            : <GitMerge size={13} aria-hidden="true" style={{ transform: "scaleY(-1)" }} />;
        return (
          <div
            key={tab.id}
            role="tab"
            id={`right-panel-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls="right-panel-content"
            tabIndex={isActive ? 0 : -1}
            ref={(el) => { tabRefs.current.set(tab.id, el); }}
            onClick={() => onSelectTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
            onMouseEnter={() => setHoveredTab(tab.id)}
            onMouseLeave={() => setHoveredTab(null)}
            className="right-panel-tab"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 26,
              paddingLeft: 10,
              paddingRight: 5,
              borderRadius: 6,
              background: isActive ? "var(--bg-selected)" : isHovered ? "var(--bg-hover)" : "transparent",
              cursor: "pointer",
              fontSize: 12,
              color: isActive || isHovered ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              minWidth: 64,
              maxWidth: 180,
              flexShrink: 0,
              userSelect: "none",
              outline: "none",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              {icon}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={isFileTab(tab) ? tab.filePath : label}
            >
              {label}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20,
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                border: "none",
                borderRadius: 4,
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                transition: "background 0.1s, color 0.1s",
              }}
              title={t("desktop.closeTab")}
              aria-label={t("desktop.closeTabWithLabel", { label })}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
