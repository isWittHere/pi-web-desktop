import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// ProcessGroup relies on many React providers (theme, i18n, timers) and a
// rich block model, so its P1 coverage is asserted at the source level:
// every Markdown-rendering path inside a step must forward `isStreaming`,
// which switches MarkdownBody into incremental (stable-part) rendering and
// defers Prism for the growing tail.

const source = await readFile(new URL("./ProcessGroup.tsx", import.meta.url), "utf8");

test("StepContent forwards isStreaming to ProcessNarrative for thinking steps", () => {
  const thinkingBranch = source.match(
    /if \(step\.kind === "thinking"\) \{[\s\S]*?return <ProcessNarrative blocks=\{step\.blocks\}[\s\S]*?isStreaming=\{isStreaming\} \/>;/,
  );
  assert.ok(thinkingBranch, "thinking step must render ProcessNarrative with isStreaming");
});

test("StepContent forwards isStreaming to ProcessNarrative for tool and toolGroup steps", () => {
  // leadBlocks narrative in single-tool steps
  assert.match(source, /<ProcessNarrative blocks=\{step\.leadBlocks\}[\s\S]*?isStreaming=\{isStreaming\} \/>/);
  // leadBlocks narrative in grouped tool steps
  assert.match(source, /<ProcessNarrative blocks=\{step\.leadBlocks\[idx\]\}[\s\S]*?isStreaming=\{isStreaming\} \/>/);
});

test("StepContent forwards isStreaming to MessageView for custom steps", () => {
  assert.match(
    source,
    /<MessageView message=\{step\.block\.message\} cwd=\{cwd\} onOpenFile=\{onOpenFile\} isStreaming=\{isStreaming\} \/>/,
  );
});

test("ProcessNarrative forwards isStreaming to MarkdownBody and ThinkingBlock", () => {
  // text narrative → MarkdownBody
  assert.match(
    source,
    /<MarkdownBody key=\{block\.id\} cwd=\{cwd\} onOpenFile=\{onOpenFile\} className="!text-text-dim" isStreaming=\{isStreaming\}>/,
  );
  // thinking narrative → ThinkingBlock (contentOnly) with isStreaming
  const thinkingCall = source.match(/<ThinkingBlock[\s\S]*?contentOnly[\s\S]*?isStreaming=\{isStreaming\}\s*\/>/);
  assert.ok(thinkingCall, "thinking narrative must render ThinkingBlock with isStreaming");
});

test("all three StepContent call sites pass isStreaming", () => {
  const calls = source.match(/<StepContent [^>]*\/>/g) ?? [];
  assert.equal(calls.length, 3, "exactly three StepContent render sites");
  for (const call of calls) {
    assert.match(call, /isStreaming=\{isStreaming\}/);
  }
});

test("step narrative keeps its dimmed styling while streaming", () => {
  // isStreaming must not bypass the existing narrative presentation.
  assert.match(source, /className="!text-text-dim" isStreaming=\{isStreaming\}/);
});
