import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";

const schema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, code: [["className", /^language-./, "math-inline", "math-display"]] },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

const plugins = {
  remark: [remarkGfm, remarkMath],
  rehype: [rehypeRaw, [rehypeSanitize, schema], [rehypeKatex, { throwOnError: false, strict: false }]],
};

function normalizeDisplayMath(markdown) {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fence = null;
  return lines.map((line) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const size = fenceMatch[1].length;
      if (!fence) fence = { marker, size };
      else if (marker === fence.marker && size >= fence.size) fence = null;
      return line;
    }
    if (fence) return line;
    const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
    if (!displayMathMatch) return line;
    const math = displayMathMatch[2].trim();
    if (!math) return line;
    return `${displayMathMatch[1]}$$${lineBreak}${math}${lineBreak}${displayMathMatch[1]}$$`;
  }).join(lineBreak);
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
function splitStableParts(markdown) {
  if (markdown.length === 0) return [];
  const lines = markdown.split(/\r?\n/);
  let fenceMarker = "", fenceSize = 0, inFence = false, lastOpenFenceLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = FENCE_OPEN.exec(lines[i]);
    if (!inFence) {
      if (match) { fenceMarker = match[1][0]; fenceSize = match[1].length; inFence = true; lastOpenFenceLine = i; }
    } else if (match && match[1][0] === fenceMarker && match[1].length >= fenceSize) {
      inFence = false; fenceMarker = ""; fenceSize = 0; lastOpenFenceLine = -1;
    }
  }
  let tailStartLine;
  if (lastOpenFenceLine >= 0) tailStartLine = lastOpenFenceLine;
  else {
    let lastBlankLine = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i] === "") lastBlankLine = i;
    tailStartLine = lastBlankLine + 1;
  }
  const stableLines = lines.slice(0, tailStartLine);
  const tailLines = lines.slice(tailStartLine);
  const parts = [];
  let partLines = [];
  const flush = () => {
    while (partLines.length > 0 && partLines[partLines.length - 1] === "") partLines.pop();
    while (partLines.length > 0 && partLines[0] === "") partLines.shift();
    if (partLines.length > 0) { parts.push(partLines.join("\n")); partLines = []; }
  };
  for (const line of stableLines) {
    if (line === "" && partLines.length > 0) flush();
    else partLines.push(line);
  }
  if (partLines.length > 0) flush();
  while (tailLines.length > 0 && tailLines[0] === "") tailLines.shift();
  if (tailLines.length > 0) parts.push(tailLines.join("\n"));
  return parts;
}

function renderPart(md) {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, plugins, md)
  );
}

function hasNestedP(html) {
  return /<p>((?!<\/p>).)*<p>/.test(html);
}

// Full thinking text from the session entry fa6c3164
import fs from "fs";
const lines = fs.readFileSync(process.env.HOME + "/.pi/agent/sessions/--E--Dev-pi-web-main--/2026-08-03T11-12-54-440Z_019fc753-a0a8-7815-8c5a-9ff9c98c9c14.jsonl", "utf8").split("\n").filter(Boolean);
let thinking = "";
for (const l of lines) {
  try {
    const j = JSON.parse(l);
    if (j.type === "message" && j.message.role === "assistant") {
      for (const block of j.message.content) {
        if (block.type === "thinking") thinking = block.thinking;
      }
    }
  } catch (e) {}
}

// Simulate streaming: prefixes of the thinking text, run full pipeline, check tail part
let found = 0;
for (let len = 1; len <= thinking.length; len++) {
  const norm = normalizeDisplayMath(thinking.slice(0, len));
  const parts = splitStableParts(norm);
  if (parts.length === 0) continue;
  const tailHtml = renderPart(parts[parts.length - 1]);
  if (hasNestedP(tailHtml)) {
    found++;
    if (found <= 3) {
      console.log("=== NESTED <p> FOUND at prefix len", len, "===");
      console.log("tail part (first 200 chars):", JSON.stringify(parts[parts.length - 1].slice(0, 200)));
      console.log("tail html:", tailHtml.slice(0, 400));
      console.log();
    }
  }
}
console.log("total nested-p states:", found, "of", thinking.length);
