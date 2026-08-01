"use client";

import { useEffect, useRef, useState, useCallback, useMemo, RefObject } from "react";
import type { AgentMessage, AssistantMessage, TextContent } from "@/lib/types";

interface Props {
  messages: AgentMessage[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onWidthChange?: (width: number) => void;
}

const MINIMAP_WIDTH = 18;
const LANE_WIDTH = 5;
const LANE_GAP = 1;
const LANE_PADDING = 2;
const MIN_MARKER_HEIGHT = 3;
const MARKER_GAP = 1;
const PREVIEW_LINE_HEIGHT = 15;
const PREVIEW_PADDING_Y = 4;
const MAX_PREVIEW_LINES = 5;

function stripXmlTags(text: string): string {
  return text
    // Thinking is sometimes stored as a text block, and some providers escape
    // tags before storing them. Handle both forms before creating the preview.
    .replace(/<\/?[\w:-]+\b[^>]*>/g, " ")
    .replace(/&lt;\/?[\w:-]+\b[^&]*?&gt;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface DisplayNode extends NodeInfo {
  displayTopPx: number;
  lane: number;
}

function getMinimapWidth(laneCount: number): number {
  return Math.max(MINIMAP_WIDTH, LANE_PADDING * 2 + laneCount * LANE_WIDTH + (laneCount - 1) * LANE_GAP);
}

function getMessagePreview(msg: AgentMessage | Partial<AgentMessage>): string {
  if (msg.role === "user") {
    const content = msg.content;
    if (typeof content === "string") return content.slice(0, 200);
    if (Array.isArray(content)) {
      return (content as { type: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n")
        .slice(0, 200);
    }
    return "";
  }
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    const text = blocks
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    if (text) return stripXmlTags(text).slice(0, 200);
    const thinking = blocks
      .filter((b) => b.type === "thinking")
      .map((b) => stripXmlTags((b as { type: string; thinking?: string }).thinking ?? ""))
      .filter(Boolean)
      .join(" ");
    if (thinking) return thinking.slice(0, 200);
    const toolNames = blocks
      .filter((b) => b.type === "toolCall")
      .map((b) => (b as { type: string; toolName: string }).toolName);
    if (toolNames.length) return toolNames.join(", ");
    return "";
  }
  return "";
}

function getNodeColor(msg: AgentMessage | Partial<AgentMessage>): string {
  if (msg.role === "user") return "var(--accent)";

  const blocks = (msg as Partial<AssistantMessage>).content ?? [];
  const hasFailedTool = blocks.some((block) => block.type === "toolCall" && (block as { error?: string }).error);
  if (hasFailedTool) return "var(--accent-red)";
  if (blocks.some((block) => block.type === "toolCall")) return "var(--accent-green)";
  return "var(--text-dim)";
}

function getPreviewBackground(msg: AgentMessage | Partial<AgentMessage>): string {
  if (msg.role === "user") return "var(--minimap-preview-user-bg)";

  const blocks = (msg as Partial<AssistantMessage>).content ?? [];
  if (blocks.some((block) => block.type === "toolCall" && (block as { error?: string }).error)) {
    return "var(--minimap-preview-error-bg)";
  }
  if (blocks.some((block) => block.type === "toolCall")) return "var(--minimap-preview-tool-bg)";
  return "var(--minimap-preview-default-bg)";
}

// Higher-priority navigation landmarks stay visible when message extents touch.
function getNodeLayer(msg: AgentMessage | Partial<AgentMessage>): number {
  if (msg.role === "user") return 6;

  const blocks = (msg as Partial<AssistantMessage>).content ?? [];
  if (blocks.some((block) => block.type === "toolCall" && (block as { error?: string }).error)) return 5;
  if (blocks.some((block) => block.type === "text" && Boolean((block as TextContent).text?.trim()))) return 4;
  if (blocks.some((block) => block.type === "toolCall")) return 3;
  return 2;
}

function hasTextContent(msg: AgentMessage | Partial<AgentMessage>): boolean {
  if (msg.role === "user") return true;
  if (msg.role === "assistant") {
    const blocks = (msg as Partial<AssistantMessage>).content ?? [];
    return blocks.some((b) => b.type === "text");
  }
  return false;
}

interface NodeInfo {
  topRatio: number;   // 0–1 within total scroll height
  heightRatio: number;
  msg: AgentMessage | Partial<AgentMessage>;
  index: number;
}

export function ChatMinimap({ messages, streamingMessage, scrollContainer, messageRefs, onWidthChange }: Props) {
  const [scrollRatio, setScrollRatio] = useState(0);
  const [viewportRatio, setViewportRatio] = useState(1);
  const [visible, setVisible] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);
  const [minimapHeightPx, setMinimapHeightPx] = useState(0);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages) as (AgentMessage | Partial<AgentMessage>)[],
    [messages, streamingMessage]
  );
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;

  // --- 仅更新视口比例，不读取 DOM ---
  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const totalH = scrollEl.scrollHeight;
    const clientH = scrollEl.clientHeight;
    const scrollable = totalH - clientH;
    setVisible(scrollable > 20);
    if (scrollable <= 0) {
      setScrollRatio(0);
      setViewportRatio(1);
    } else {
      setScrollRatio(scrollEl.scrollTop / scrollable);
      setViewportRatio(clientH / totalH);
    }
  }, [scrollContainer]);

  // --- 节流 DOM 测量（仅消息变化/尺寸变化时触发，最多 150ms 一次）---
  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodesRef = useRef<NodeInfo[]>([]);
  const measureNodes = useCallback(() => {
    // 节流：150ms 内忽略重复调用
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      if (!scrollEl) return;
      const totalH = scrollEl.scrollHeight;
      if (totalH <= 0) return;

      const refs = messageRefs.current;
      const newNodes: NodeInfo[] = [];
      let refIndex = 0;
      const allMessages = allMessagesRef.current;

      for (let i = 0; i < allMessages.length; i++) {
        const msg = allMessages[i];
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        const el = refs?.[refIndex];
        refIndex++;
        if (!hasTextContent(msg)) continue;
        if (el) {
          const elRect = el.getBoundingClientRect();
          const containerRect = scrollEl.getBoundingClientRect();
          const top = elRect.top - containerRect.top + scrollEl.scrollTop;
          const h = elRect.height;
          newNodes.push({
            topRatio: top / totalH,
            heightRatio: h / totalH,
            msg,
            index: newNodes.length,
          });
        }
      }
      // Commit only when measurements actually changed. Without this guard a
      // dense session feeds a setState → re-render → minimap width change →
      // container reflow → ResizeObserver → re-measure loop that ends in a
      // "Maximum update depth exceeded" renderer crash.
      const prev = nodesRef.current;
      if (
        prev.length === newNodes.length &&
        newNodes.every(
          (n, i) =>
            Math.abs(n.topRatio - prev[i].topRatio) < 1e-6 &&
            Math.abs(n.heightRatio - prev[i].heightRatio) < 1e-6,
        )
      ) {
        return;
      }
      nodesRef.current = newNodes;
      setNodes(newNodes);
    }, 150);
  }, [scrollContainer, messageRefs]);

  // scroll 事件 → 只更新视口，不碰 DOM
  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => el.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  // Keep both node positions and viewport ratios in sync with layout changes.
  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      updateScroll();
      measureNodes();
    };
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    // Also observe the scroll content for height changes
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    syncLayout();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [scrollContainer, measureNodes, updateScroll]);

  // Wait briefly for new message DOM before syncing layout.
  useEffect(() => {
    const t = setTimeout(() => {
      updateScroll();
      measureNodes();
    }, 50);
    return () => clearTimeout(t);
  }, [messages.length, measureNodes, updateScroll]);

  const scrollToMinimapRatio = useCallback((viewportTopRatio: number) => {
    const el = scrollContainer.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const clamped = Math.max(0, Math.min(1 - viewportRatio, viewportTopRatio));
    el.scrollTop = (clamped / (1 - viewportRatio)) * scrollable;
  }, [scrollContainer, viewportRatio]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;

    draggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickRatio = (e.clientY - rect.top) / rect.height;
    const grabOffset = clickRatio - scrollRatio * (1 - viewportRatio);
    const insideBox = grabOffset >= 0 && grabOffset <= viewportRatio;
    const offset = insideBox ? grabOffset : viewportRatio / 2;

    scrollToMinimapRatio(clickRatio - offset);

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const r = (ev.clientY - rect.top) / rect.height;
      scrollToMinimapRatio(r - offset);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [visible, viewportRatio, scrollRatio, scrollToMinimapRatio]);



  // Keep collision calculations in screen pixels. Each message remains an
  // independent marker; dense markers move to another lane rather than merge.
  useEffect(() => {
    // The minimap is not mounted until scrolling is needed. Re-run when it
    // becomes visible so the ref exists before measuring its height.
    if (!visible) {
      setMinimapHeightPx(0);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const updateHeight = () => setMinimapHeightPx(el.clientHeight);
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    updateHeight();
    return () => observer.disconnect();
  }, [visible]);

  const displayNodes = useMemo(() => {
    if (minimapHeightPx <= 0) return [];

    const laneEnds: number[] = [];
    return nodes.map((node) => {
      const topPx = node.topRatio * minimapHeightPx;
      const heightPx = Math.max(MIN_MARKER_HEIGHT, Math.min(46, node.heightRatio * minimapHeightPx));
      const startPx = Math.max(0, topPx - heightPx / 2);
      const endPx = Math.min(minimapHeightPx, topPx + heightPx / 2);
      let lane = laneEnds.findIndex((lastEnd) => startPx >= lastEnd + MARKER_GAP);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(endPx);
      } else {
        laneEnds[lane] = endPx;
      }
      return { ...node, displayTopPx: topPx, lane } satisfies DisplayNode;
    });
  }, [nodes, minimapHeightPx]);

  const laneCount = useMemo(
    () => displayNodes.reduce((count, node) => Math.max(count, node.lane + 1), 1),
    [displayNodes],
  );
  const minimapWidth = getMinimapWidth(laneCount);

  useEffect(() => {
    onWidthChange?.(visible ? minimapWidth : MINIMAP_WIDTH);
  }, [minimapWidth, onWidthChange, visible]);

  useEffect(() => () => onWidthChange?.(MINIMAP_WIDTH), [onWidthChange]);

  if (!visible) return null;

  const viewportBoxTop = scrollRatio * (1 - viewportRatio) * 100;
  const viewportBoxHeight = viewportRatio * 100;

  // Only one preview is shown: rendering every preview cannot be made
  // collision-free when a long session has more messages than vertical pixels.
  const nearestNode = mouseYRatio !== null && displayNodes.length > 0
    ? displayNodes.reduce((best, node) => (
        Math.abs(node.displayTopPx / minimapHeightPx - mouseYRatio)
          < Math.abs(displayNodes[best].displayTopPx / minimapHeightPx - mouseYRatio)
          ? node.index
          : best
      ), 0)
    : null;
  const hoveredNode = nearestNode === null
    ? null
    : displayNodes.find((node) => node.index === nearestNode) ?? null;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setMinimapHovered(true)}
      onMouseLeave={() => { setMinimapHovered(false); setMouseYRatio(null); }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setMouseYRatio((e.clientY - rect.top) / rect.height);
      }}
      style={{
        width: minimapWidth,
        flexShrink: 0,
        position: "relative",
        cursor: "pointer",
        userSelect: "none",
        background: "transparent",
        overflow: "visible",
      }}
    >
      {/* Viewport indicator */}
      <div
        style={{
          position: "absolute",
          left: 1,
          right: 1,
          top: `${viewportBoxTop}%`,
          height: `${viewportBoxHeight}%`,
          background: "color-mix(in srgb, var(--text-muted) 14%, transparent)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Message nodes: each message keeps its own lane and display layer. */}
      {displayNodes.map((node) => {
        const color = getNodeColor(node.msg);
        const isNearest = minimapHovered && hoveredNode?.index === node.index;
        const isUser = node.msg.role === "user";
        const markerHeight = Math.max(MIN_MARKER_HEIGHT, Math.min(46, node.heightRatio * minimapHeightPx));
        const left = LANE_PADDING + node.lane * (LANE_WIDTH + LANE_GAP);

        return (
          <div
            key={node.index}
            style={{
              position: "absolute",
              top: node.displayTopPx,
              transform: "translateY(-50%)",
              left,
              width: LANE_WIDTH,
              height: markerHeight,
              display: "flex",
              alignItems: "stretch",
              cursor: "pointer",
              zIndex: getNodeLayer(node.msg),
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: 1,
                background: color,
                opacity: isNearest ? 1 : isUser ? 0.92 : 0.72,
                transition: "opacity 0.1s, filter 0.1s",
                filter: isNearest ? "brightness(1.2)" : "none",
              }}
            />
          </div>
        );
      })}

      {/* A single nearby preview avoids tooltip collisions in dense sessions. */}
      {minimapHovered && hoveredNode && (() => {
        const preview = getMessagePreview(hoveredNode.msg);
        if (!preview) return null;
        const previewBackground = getPreviewBackground(hoveredNode.msg);
        // Taller minimaps can show more context without obscuring nearby nodes.
        const previewLines = Math.max(1, Math.min(MAX_PREVIEW_LINES, Math.floor(minimapHeightPx / 120)));
        const tooltipHeight = previewLines * PREVIEW_LINE_HEIGHT + PREVIEW_PADDING_Y;
        // Anchor the preview's visual center to its marker. The previous
        // calculation used a maximum height as a top offset, which made short
        // previews appear above the marker on tall minimaps.
        const tooltipCenter = Math.max(
          tooltipHeight / 2,
          Math.min(minimapHeightPx - tooltipHeight / 2, hoveredNode.displayTopPx),
        );
        return (
          <div
            style={{
              position: "absolute",
              top: tooltipCenter,
              transform: "translateY(-50%)",
              right: "100%",
              marginRight: 6,
              background: previewBackground,
              border: "none",
              borderRadius: 4,
              padding: "2px 7px",
              width: 220,
              zIndex: 100,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "var(--text)",
                lineHeight: `${PREVIEW_LINE_HEIGHT}px`,
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: previewLines,
                overflow: "hidden",
                overflowWrap: "anywhere",
              }}
            >
              {preview}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
