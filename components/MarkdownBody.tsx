"use client";

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import ReactMarkdown, { type Components, type ExtraProps, type Options as ReactMarkdownOptions } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { splitStableParts } from "@/lib/markdown-incremental";
import { headingId, markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { mentionRemarkPlugin, type MentionValidators } from "@/lib/mention-tokens";
import { prismTheme } from "@/lib/prism-theme";



interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  /**
   * Highlight valid @file / /skill: mentions inside text (accent + dotted
   * underline). Requires `mentionValidators` to resolve what is valid.
   */
  highlightMentions?: boolean;
  mentionValidators?: MentionValidators;
}

interface MarkdownComponentsOptions {
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

/**
 * True while rendering the children of a markdown <pre> element, i.e. a real
 * block code element. Lets the `code` component decide block vs inline from
 * the tree structure instead of content heuristics: CommonMark code spans may
 * legally span multiple lines inside a <p>, so a newline in the raw text does
 * not prove block position (rendering a <div> there breaks HTML nesting).
 */
export const MarkdownCodeContext = createContext(false);

function buildMarkdownComponents({ isStreaming, cwd, onOpenFile }: MarkdownComponentsOptions): Components {
  return {
    h1({ children }: React.ComponentProps<'h1'>) {
      return <h1 id={headingId(children)} className="scroll-mt-24 text-xl font-semibold mt-4 mb-2 text-(--text)">{children}</h1>
    },
    h2({ children }: React.ComponentProps<'h2'>) {
      return <h2 id={headingId(children)} className="scroll-mt-24 text-lg font-semibold mt-3 mb-2 text-(--text)">{children}</h2>
    },
    h3({ children }: React.ComponentProps<'h3'>) {
      return <h3 id={headingId(children)} className="scroll-mt-24 text-base font-semibold mt-3 mb-1 text-(--text)">{children}</h3>
    },
    code: function CodeElement({ className, children, ...props }: React.ComponentProps<'code'> & ExtraProps) {
      // `node` is react-markdown metadata, never a DOM attribute.
      delete props.node;
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = useContext(MarkdownCodeContext);
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
      }
      return (
        <code
          className="inline max-w-full whitespace-normal break-words [overflow-wrap:anywhere] align-baseline bg-(--bg-secondary) border border-(--border) px-1.5 py-0.5 text-xs font-mono text-(--accent-blue)"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: function PreElement({ children }: React.ComponentProps<'pre'> & ExtraProps) {
      // react-markdown wraps every fenced/indented code block in <pre>; inline
      // code spans live directly inside <p>/<li>. Announce the block position so
      // `code` can render block UI without guessing from the raw text.
      return <MarkdownCodeContext.Provider value>{children}</MarkdownCodeContext.Provider>;
    },
    a({ href, children, ...props }: React.ComponentProps<'a'> & ExtraProps) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const linkClass = "text-(--accent-blue) underline underline-offset-2 hover:text-(--accent-blue)/80";
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} className={linkClass} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} className={linkClass} onClick={handleClick}>
          {children}
        </a>
      );
    },
    table({ children }: React.ComponentProps<'table'> & ExtraProps) {
      return (
        <div className="my-3 rounded-lg overflow-hidden border border-(--border)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse [&_tr:last-child>td]:border-b-0">
              {children}
            </table>
          </div>
        </div>
      );
    },
  };
}

/**
 * One stable Markdown chunk. React.memo skips re-render while the chunk text
 * is unchanged (reference-equal via the interning cache in splitStableParts),
 * so the remark/rehype pipeline only runs for the streaming tail chunk.
 * Stable chunks are marked non-streaming: their closed code blocks get Prism
 * highlighting immediately instead of waiting for the whole message to end.
 */
const MarkdownPart = memo(function MarkdownPart({ text, isStreaming, cwd, onOpenFile, remarkPlugins }: {
  text: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  remarkPlugins?: ReactMarkdownOptions["remarkPlugins"];
}) {
  const normalized = useMemo(() => normalizeDisplayMath(text), [text]);
  const components = useMemo(
    () => buildMarkdownComponents({ isStreaming, cwd, onOpenFile }),
    [isStreaming, cwd, onOpenFile],
  );
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={markdownRehypePlugins}
      components={components}
    >
      {normalized}
    </ReactMarkdown>
  );
});

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, highlightMentions, mentionValidators }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  // Interning map: stable chunk text stays reference-stable so MarkdownPart
  // memo comparisons hit with === and skip the parse/render work entirely.
  const partCacheRef = useRef<Map<string, string>>(new Map());
  const parts = useMemo(
    () => splitStableParts(normalizedMarkdown, partCacheRef.current),
    [normalizedMarkdown],
  );
  const streamingSplit = isStreaming && parts.length > 1;
  const components = useMemo(
    () => buildMarkdownComponents({ isStreaming, cwd, onOpenFile }),
    [isStreaming, cwd, onOpenFile],
  );
  const mentionPlugins = useMemo(
    () => (highlightMentions && mentionValidators ? [mentionRemarkPlugin(mentionValidators)] : []),
    [highlightMentions, mentionValidators],
  );
  const remarkPlugins = useMemo(
    () => [...(markdownRemarkPlugins ?? []), ...mentionPlugins],
    [mentionPlugins],
  );

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      {streamingSplit ? (
        parts.map((part, index) => (
          <MarkdownPart
            key={`${index}-${part.id}`}
            text={part.text}
            isStreaming={part.tail ? isStreaming : false}
            cwd={cwd}
            onOpenFile={onOpenFile}
            remarkPlugins={remarkPlugins}
          />
        ))
      ) : (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={markdownRehypePlugins}
          components={components}
        >
          {normalizedMarkdown}
        </ReactMarkdown>
      )}
    </div>
  );
}

export function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const [showPreview, setShowPreview] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setFailedKey(null);

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error("Invalid Mermaid diagram");

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setSvg(result.svg);
        setRenderedKey(currentKey);
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming, showPreview]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={isStreaming
              ? t("desktop.markdownPreviewAvailableAfterStreaming")
              : (showPreview ? t("desktop.source") : t("desktop.markdownPreviewMermaidDiagram"))}
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? t("desktop.source") : t("desktop.preview")}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">{t("desktop.markdownInvalidMermaidDiagram")}</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label={t("desktop.markdownRenderingMermaidDiagram")} />
    ) : (
      <div
        className="mermaid-block"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );

  return (
    <div className="markdown-code-block">
      {body}
    </div>
  );
}

export function CodeBlock({ code, lang, headerAction, isStreaming }: { code: string; lang: string; headerAction?: ReactNode; isStreaming?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="markdown-code-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        position: "absolute",
        top: 6,
        right: 8,
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: 6,
        opacity: hovered ? 1 : 0,
        pointerEvents: hovered ? "auto" : "none",
        transition: "opacity 0.12s",
      }}>
        <span style={{
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          userSelect: "none",
        }}>{lang || t("desktop.markdownPlainText")}</span>
        {headerAction}
        <button
          onClick={copy}
          title={copied ? t("desktop.copied") : t("desktop.copy")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            border: "none",
            borderRadius: 5,
            background: "transparent",
            color: copied ? "var(--accent)" : "var(--text-dim)",
            cursor: "pointer",
            fontSize: 10,
            transition: "color 0.12s",
          }}
          onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
        >
          {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
        </button>
      </div>
      {isStreaming ? (
        // Prism tokenization is synchronous and grows with the whole unfinished
        // block. Preserve readable source while streaming, then highlight once
        // the final message replaces this transient view.
        <pre className="markdown-code-streaming"><code>{code}</code></pre>
      ) : (
        <SyntaxHighlighter
          language={lang || "text"}
          style={prismTheme}
          showLineNumbers={false}
          customStyle={{
            margin: 0,
            padding: "10px 16px",
            fontSize: 13,
            lineHeight: 1.65,
            borderRadius: 0,
            border: "none",
            background: "var(--bg-secondary)",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
        >
          {code}
        </SyntaxHighlighter>
      )}
    </div>
  );
}
