"use client";

import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  isRecordChildren,
  parsePromptTree,
  type XmlTreeElement,
  type XmlNode,
} from "@/lib/xml-tree";

interface SystemPromptTreeProps {
  systemPrompt: string;
}

/**
 * Hybrid renderer for pi's system prompt: markdown fragments render as
 * markdown; XML wrapper tags render as collapsible chip trees. Key-value
 * records (`<skill>`, `<environment>`) render as compact chip+value field
 * lists with the `name` field promoted to the chip row.
 *
 * Parsing is fence-aware: XML-looking samples inside markdown code fences
 * are never parsed as structure.
 */
export function SystemPromptTree({ systemPrompt }: SystemPromptTreeProps) {
  const tree = useMemo(() => parsePromptTree(systemPrompt), [systemPrompt]);
  // Expansion state: open nodes keyed by a stable path from the root.
  const [openNodes, setOpenNodes] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (let i = 0; i < tree.children.length; i++) {
      initial.add(nodeKey(i));
    }
    return initial;
  });

  const toggle = useCallback((path: string) => {
    setOpenNodes((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className="sp-tree">
      {tree.children.map((child, i) => (
        <ChipNode
          key={nodeKey(i)}
          node={child}
          path={nodeKey(i)}
          depth={1}
          openNodes={openNodes}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

function nodeKey(i: number): string {
  return `c${i}`;
}

// CJK-aware token estimate for a subtree (~4 latin chars/token, CJK chars
// count as 1) — same heuristic as SessionInfoBar's whole-prompt estimate.
function estimateTokens(node: XmlNode): number {
  let tokens = 0;
  const walk = (n: XmlNode) => {
    for (const c of (n as XmlTreeElement).children || []) {
      if (c.kind === "text") {
        for (const ch of c.raw) {
          const code = ch.codePointAt(0) ?? 0;
          if ((code >= 0x4E00 && code <= 0x9FFF) ||
              (code >= 0x3400 && code <= 0x4DBF) ||
              (code >= 0x20000 && code <= 0x2A6DF) ||
              (code >= 0x3040 && code <= 0x309F) ||
              (code >= 0x30A0 && code <= 0x30FF) ||
              (code >= 0xAC00 && code <= 0xD7AF)) {
            tokens += 1;
          } else {
            tokens += 0.25;
          }
        }
      } else {
        walk(c);
      }
    }
  };
  walk(node);
  return Math.round(tokens);
}

function formatTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

interface ChipNodeProps {
  node: XmlNode;
  path: string;
  depth: number;
  openNodes: Set<string>;
  onToggle: (path: string) => void;
}

function ChipNode({ node, path, depth, openNodes, onToggle }: ChipNodeProps) {
  const isOpen = openNodes.has(path);
  const childPath = (i: number) => `${path}/${nodeKey(i)}`;
  // Hooks must run before any early return — compute the token estimate
  // unconditionally (cheap: subtree text scan).
  const subtreeTokens = useMemo(() => estimateTokens(node), [node]);

  if (node.kind === "text") {
    return (
      <div className="sp-node">
        <div className="sp-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.raw}</ReactMarkdown>
        </div>
      </div>
    );
  }

  const isLeaf = node.children.length === 0;
  const isRecord = isRecordChildren(node.children);
  const nameField = isRecord ? node.children.find((c) => c.kind === "xml" && c.tag === "name") : undefined;
  const nameValue =
    nameField && nameField.kind === "xml" && nameField.children[0].kind === "text"
      ? nameField.children[0].raw.trim()
      : undefined;

  // Token estimate: only on the top-level chip row (depth 1), computed
  // from this node's own subtree (~4 chars/token, CJK chars count as 1).
  const showTokens = depth === 1 && subtreeTokens > 0;

  const handleToggle = () => {
    if (!isLeaf) onToggle(path);
  };

  return (
    <div className={`sp-node sp-depth-${Math.min(depth, 4)}${isLeaf ? " leaf" : ""}`}>
      <div
        className="sp-chip-row"
        onClick={handleToggle}
        role={isLeaf ? undefined : "button"}
        aria-expanded={isLeaf ? undefined : isOpen}
        tabIndex={isLeaf ? undefined : 0}
        onKeyDown={isLeaf ? undefined : (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <span className="sp-chip">
          {node.tag}
          {node.attrs ? <span className="sp-attrs">{node.attrs}</span> : null}
        </span>
        {nameValue ? <span className="sp-name-value">{nameValue}</span> : null}
        {showTokens ? <span className="sp-meta">~{formatTokens(subtreeTokens)} tok</span> : null}
      </div>

      {isLeaf ? null : isRecord ? (
        <RecordCard node={node} isOpen={isOpen} skipTag="name" />
      ) : node.children.length === 1 && node.children[0].kind === "text" ? (
        <div className={`sp-single-body${isOpen ? "" : " sp-hidden"}`}>
          <div className="sp-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.children[0].raw}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className={`sp-children${isOpen ? "" : " sp-hidden"}`}>
          {node.children.map((child, i) => (
            <ChipNode
              key={childPath(i)}
              node={child}
              path={childPath(i)}
              depth={depth + 1}
              openNodes={openNodes}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecordCard({ node, isOpen, skipTag }: { node: Extract<XmlNode, { kind: "xml" }>; isOpen: boolean; skipTag?: string }) {
  const fields = node.children.filter(
    (c): c is Extract<XmlNode, { kind: "xml" }> => c.kind === "xml" && !(skipTag && c.tag === skipTag),
  );
  // Label column sized to the longest field-name chip: character count ×
  // mono character width (~0.6em) + 16px chip padding + 4px margin, so the
  // chip never overflows into the value column.
  const longest = Math.max(...fields.map((f) => f.tag.length), 1);
  const labelW = `calc(${Math.min(20, longest)}ch + 20px)`;

  return (
    <div className={`sp-record${isOpen ? "" : " sp-hidden"}`} style={{ "--sp-label-w": labelW } as React.CSSProperties}>
      {fields.map((f, i) => {
        const value = f.children[0];
        const text = value.kind === "text" ? value.raw.trim() : "";
        return (
          <div className="sp-field" key={i}>
            <span className="sp-chip">{f.tag}</span>
            <span className="sp-field-value">{text}</span>
          </div>
        );
      })}
    </div>
  );
}
