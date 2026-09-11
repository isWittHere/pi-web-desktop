"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GitDiff, GitMerge, X } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { getFileIcon } from "./FileIcons";
import { isFileTab, type Tab } from "./tab-model";

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  /** Bumped whenever a new tab is opened explicitly (file open, view-tab
   *  open): an intent to reveal the newly active tab. Plain programmatic
   *  activeTabId changes (close-tab fallback, workspace restore) never bump
   *  it — they must not steal the user's scroll position. */
  focusToken?: number;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, focusToken = 0 }: Props) {
  const { t } = useI18n();
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement | null>());
  const stripRef = useRef<HTMLDivElement>(null);

  // A tab closed while hovered (close button or middle-click) leaves the
  // stale hover id behind: reopening the same id later (same file path, same
  // workspace view tab) would render pre-lit with no mouseleave to clear it —
  // the pointer was never over the new element. Prune ids that no longer
  // exist whenever the tab list changes (same guard as the workspace strip).
  useEffect(() => {
    setHoveredTab((cur) => (cur !== null && !tabs.some((t) => t.id === cur) ? null : cur));
    setHoveredClose((cur) => (cur !== null && !tabs.some((t) => t.id === cur) ? null : cur));
  }, [tabs]);

  // Reveal a tab: scroll the strip so the tab is fully visible. The strip's
  // scrollbar is hidden, so an un-revealed tab is effectively invisible.
  // Same contract as the workspace tab strip in the title bar. Uses rect
  // math (not offsetLeft) so it stays correct even when an ancestor is
  // positioned.
  const scrollToTab = useCallback((key: string, behavior: ScrollBehavior = "smooth") => {
    const strip = stripRef.current;
    const el = tabRefs.current.get(key);
    if (!strip || !el) return;
    const sRect = strip.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const MARGIN = 10;
    const left = eRect.left - sRect.left + strip.scrollLeft;
    const right = left + eRect.width;
    const viewLeft = strip.scrollLeft;
    const viewRight = viewLeft + strip.clientWidth;
    if (left < viewLeft + MARGIN) {
      strip.scrollTo({ left: left - MARGIN, behavior });
    } else if (right > viewRight - MARGIN) {
      strip.scrollTo({ left: right - strip.clientWidth + MARGIN, behavior });
    }
  }, []);

  // Wheel-to-horizontal scrolling, same contract as the workspace tab strip.
  // Must be a native non-passive listener: React registers wheel passively
  // at the root, so preventDefault() inside onWheel is a no-op. The gate
  // uses the live DOM scrollable range (not state) so it is immune to layout
  // async gaps; the wheel passes through at the ends so it never traps over
  // the bar.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      if (maxScroll <= 1) return;
      // Touchpads already produce deltaX for lateral swipes; wheels only
      // produce deltaY — map it to the horizontal axis.
      const raw = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      // Line-mode deltas (deltaMode 1) scroll too slowly as raw pixels.
      const px = e.deltaMode === 1 ? raw * 16 : raw;
      const canGo = (px < 0 && strip.scrollLeft > 0) || (px > 0 && strip.scrollLeft < maxScroll);
      if (!canGo) return;
      e.preventDefault();
      strip.scrollLeft += px;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  // Reveal the initially active tab on mount: the strip mounts when the right
  // panel opens or the first file tab is created, so the restored active tab
  // may sit off-screen. The key is captured in a ref at mount render so later
  // programmatic activeTabId changes never steal the user's scroll position
  // (click and keyboard paths call scrollToTab explicitly). rAF: the first
  // layout pass after mount can still be unstable.
  const mountActiveTabRef = useRef(activeTabId);
  useEffect(() => {
    const initial = mountActiveTabRef.current;
    if (!initial) return;
    const raf = requestAnimationFrame(() => scrollToTab(initial, "auto"));
    return () => cancelAnimationFrame(raf);
  }, [scrollToTab]);

  // Explicitly opened tab: the focusToken bump is an intent to reveal it,
  // so scroll the newly active tab into view. Token bumps are batched with
  // the tab state update, so props.activeTabId is already the opened tab
  // when this effect runs (same contract as the workspace tab strip).
  const prevFocusTokenRef = useRef(focusToken);
  useEffect(() => {
    if (focusToken === prevFocusTokenRef.current) return;
    prevFocusTokenRef.current = focusToken;
    if (activeTabId) scrollToTab(activeTabId, "smooth");
  }, [focusToken, activeTabId, scrollToTab]);

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
    scrollToTab(nextId);
    tabRefs.current.get(nextId)?.focus();
  };

  return (
    <div
      ref={stripRef}
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
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el);
              else tabRefs.current.delete(tab.id);
            }}
            onClick={() => {
              scrollToTab(tab.id);
              onSelectTab(tab.id);
            }}
            onMouseDown={(e) => {
              // Middle-click closes the tab, browser-style. preventDefault
              // stops the autoscroll the strip's overflowX would otherwise
              // start. The close button's own left-click path is untouched;
              // a middle press anywhere on the tab (button included, via
              // bubbling) closes it.
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.id);
              }
            }}
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
