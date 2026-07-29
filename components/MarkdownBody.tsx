"use client";

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useLanguage } from "@/hooks/useLanguage";
import { useTheme } from "@/hooks/useTheme";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { headingId, markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";

const markdownLabels = {
  en: {
    previewAvailableAfterStreaming: "Preview available after streaming",
    previewMermaidDiagram: "Preview Mermaid diagram",
    invalidMermaidDiagram: "Invalid Mermaid diagram",
    renderingMermaidDiagram: "Rendering Mermaid diagram",
    plainText: "text",
  },
  "zh-CN": {
    previewAvailableAfterStreaming: "流式输出结束后可预览",
    previewMermaidDiagram: "预览 Mermaid 图表",
    invalidMermaidDiagram: "无效的 Mermaid 图表",
    renderingMermaidDiagram: "正在渲染 Mermaid 图表",
    plainText: "文本",
  },
} as const;

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={{
          h1({ children }: React.ComponentProps<'h1'>) {
            return <h1 id={headingId(children)} className="scroll-mt-24 text-xl font-semibold mt-4 mb-2 text-(--text)">{children}</h1>
          },
          h2({ children }: React.ComponentProps<'h2'>) {
            return <h2 id={headingId(children)} className="scroll-mt-24 text-lg font-semibold mt-3 mb-2 text-(--text)">{children}</h2>
          },
          h3({ children }: React.ComponentProps<'h3'>) {
            return <h3 id={headingId(children)} className="scroll-mt-24 text-base font-semibold mt-3 mb-1 text-(--text)">{children}</h3>
          },
          code({ className, children, ...props }) {
            const lang = className?.replace("language-", "").toLowerCase() ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              if (lang === "mermaid") {
                return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
              }
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
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
          pre({ children }) {
            return <>{children}</>;
          },
          a({ href, children, ...props }) {
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
          table({ children }) {
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
        }}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

export function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { language, t } = useLanguage();
  const labels = markdownLabels[language];
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
      title={isStreaming ? labels.previewAvailableAfterStreaming : (showPreview ? t("source") : labels.previewMermaidDiagram)}
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? t("source") : t("preview")}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">{labels.invalidMermaidDiagram}</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div className="mermaid-block mermaid-block-loading" aria-label={labels.renderingMermaidDiagram} />
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

export function CodeBlock({ code, lang, headerAction }: { code: string; lang: string; headerAction?: ReactNode }) {
  const { language, t } = useLanguage();
  const labels = markdownLabels[language];
  const { isDark } = useTheme();
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
        }}>{lang || labels.plainText}</span>
        {headerAction}
        <button
          onClick={copy}
          title={copied ? t("copied") : t("copy")}
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
      <SyntaxHighlighter
        language={lang || "text"}
        style={isDark ? vscDarkPlus : vs}
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
    </div>
  );
}
