import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { I18nContext } = await jiti.import("@/hooks/useI18n");

const i18nValue = {
  locale: "en",
  setLocale() {},
  t: (key) => key,
  supportedLocales: [],
};

function renderMarkdown(markdown, isStreaming = false) {
  return renderToStaticMarkup(
    React.createElement(
      I18nContext.Provider,
      { value: i18nValue },
      React.createElement(
        MarkdownBody,
        {
          cwd: "/home/me/project",
          isStreaming,
          onOpenFile() {},
        },
        markdown,
      ),
    ),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /title="\/home\/me\/project\/components\/MarkdownBody\.tsx"/);
  assert.match(html, /role="button"/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("turns inline-code local paths into file action triggers", () => {
  const html = renderMarkdown("`output/demo.mp4`");

  assert.match(html, /title="\/home\/me\/project\/output\/demo\.mp4"/);
  assert.match(html, /role="button"/);
});

test("renders local markdown images through the file preview API", () => {
  const html = renderMarkdown("![preview](images/demo.png)");

  assert.match(html, /src="\/api\/files\/home\/me\/project\/images\/demo\.png\?type=read"/);
});

test("defers Prism highlighting while a code block is streaming", async () => {
  const source = await readFile(new URL("./MarkdownBody.tsx", import.meta.url), "utf8");
  const codeBlockSource = source.slice(source.indexOf("export function CodeBlock"));

  assert.match(codeBlockSource, /isStreaming \? \(/);
  assert.match(codeBlockSource, /<pre className="markdown-code-streaming"><code>\{code\}<\/code><\/pre>/);
  assert.match(codeBlockSource, /\) : \(\s*<SyntaxHighlighter/s);
});

test("streaming split: closed code block is highlighted, growing tail uses plain pre", () => {
  const html = renderMarkdown(
    "stable para\n\n```ts\nconst x = 1;\n```\n\ngrowing tail",
    true,
  );
  // The stable part (closed fence) renders with Prism tokens immediately...
  assert.match(html, /<p>stable para<\/p>/);
  assert.match(html, /token[^>]*>[^<]*const/);
  // ...while the growing tail stays a plain paragraph.
  assert.match(html, /<p>growing tail<\/p>/);
  // The tail has no code block, so no streaming <pre> appears.
  assert.doesNotMatch(html, /markdown-code-streaming/);
});

test("streaming split: unterminated fence stays a streaming pre", () => {
  const html = renderMarkdown(
    "before\n\n```ts\nconst x = 1;\nconst y =",
    true,
  );
  assert.match(html, /<p>before<\/p>/);
  assert.match(html, /markdown-code-streaming/);
  assert.doesNotMatch(html, /token[^>]*>[^<]*const y/);
});

test("non-streaming render is unchanged: no split, no streaming pre", () => {
  const html = renderMarkdown("a\n\n```js\nlet z = 1;\n```\n\nb");
  assert.doesNotMatch(html, /markdown-code-streaming/);
  // Prism highlights the single code block as before.
  assert.match(html, /token[^>]*>[^<]*let/);
});

test("multi-line inline code span stays inline, not a block <div>", () => {
  // CommonMark code spans may legally span lines inside a paragraph; the old
  // content heuristic (raw.includes("\n")) turned this into a CodeBlock,
  // putting <div>s inside the <p> and breaking HTML nesting/hydration.
  // remark collapses the span's line breaks to spaces when rendering.
  const html = renderMarkdown("考虑 `multi\nline` span");
  assert.match(html, /<p>考虑 <code[^>]*>multi line<\/code> span<\/p>/);
  assert.doesNotMatch(html, /markdown-code-block/);
  assert.doesNotMatch(html, /\snode=/);
});

test("fenced blocks render as blocks while inline spans stay inline", () => {
  const html = renderMarkdown("```js\nconst a = 1;\n```\n\ninline `x\ny` tail");
  // Real block position (inside <pre>) still produces the block UI...
  assert.match(html, /markdown-code-block/);
  // ...and the multi-line inline span inside the paragraph stays inline.
  assert.match(html, /<p>inline <code[^>]*>x y<\/code> tail<\/p>/);
});

test("Prism token colors follow theme CSS variables", async () => {
  const themeSource = await readFile(new URL("../lib/prism-theme.ts", import.meta.url), "utf8");
  const markdownSource = await readFile(new URL("./MarkdownBody.tsx", import.meta.url), "utf8");
  const fileViewerSource = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");

  assert.match(themeSource, /keyword: \{ color: "var\(--accent\)" \}/);
  assert.match(themeSource, /string: \{ color: "var\(--accent-orange\)" \}/);
  for (const source of [markdownSource, fileViewerSource]) {
    assert.match(source, /style=\{prismTheme\}/);
    assert.doesNotMatch(source, /react-syntax-highlighter\/dist\/cjs\/styles\/prism/);
  }
});
