import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { normalizeDisplayMath } from "./markdown.ts";

describe("normalizeDisplayMath", () => {
  describe("single-line $$…$$", () => {
    it("splits a single-line block into three lines", () => {
      assert.equal(normalizeDisplayMath("$$a + b$$"), "$$\na + b\n$$");
    });

    it("preserves the indent of the surrounding list item", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  $$a + b$$\n- next"),
        "- item:\n  $$\n  a + b\n  $$\n- next",
      );
    });
  });

  describe("multi-line blocks with glued delimiters", () => {
    it("moves a glued opening delimiter to its own line", () => {
      const input = "$$\n\\frac{a}{b} = c\n<d$$\n\nafter";
      assert.equal(normalizeDisplayMath(input), "$$\n\\frac{a}{b} = c\n<d\n$$\n\nafter");
    });

    it("moves a glued closing delimiter to its own line", () => {
      const input = "$$\nx = y\nz = w$$\n\nafter";
      assert.equal(normalizeDisplayMath(input), "$$\nx = y\nz = w\n$$\n\nafter");
    });
  });

  describe("blocks nested in GFM list items", () => {
    it("re-indents lazy content lines of an indented bare-fence block", () => {
      const input = "- item:\n  $$\nx = y\n  $$\n- next";
      assert.equal(normalizeDisplayMath(input), "- item:\n  $$\n  x = y\n  $$\n- next");
    });

    it("re-indents partially indented content lines", () => {
      const input = "- item:\n  $$\n x = y\n  $$\n- next";
      assert.equal(normalizeDisplayMath(input), "- item:\n  $$\n  x = y\n  $$\n- next");
    });

    it("does not use a sibling list item's formula as a closing fence", () => {
      const input = "- first\n  $$x = y\n- second\n  $$z = w$$\n- third";
      assert.equal(
        normalizeDisplayMath(input),
        "- first\n  $$x = y\n- second\n  $$\n  z = w\n  $$\n- third",
      );
    });

    it("does not scan a bare fence past a sibling list item", () => {
      const input = "- first\n  $$\nx = y\n- second\n  $$z = w$$\n- third";
      assert.equal(
        normalizeDisplayMath(input),
        "- first\n  $$\nx = y\n- second\n  $$\n  z = w\n  $$\n- third",
      );
    });
  });

  describe("blocks that must stay untouched", () => {
    it("leaves a top-level block with detached delimiters untouched", () => {
      const input = "$$\n\\frac{a}{b}\n$$\n\nend";
      assert.equal(normalizeDisplayMath(input), input);
    });

    it("leaves content inside fenced code blocks untouched", () => {
      const input = "```\n$$ not math $$\n$$\n```\n\nreal $$x = 1$$ end";
      const normalized = normalizeDisplayMath(input);
      assert.ok(normalized.includes("```\n$$ not math $$\n$$\n```"));
      // every `$$` is preserved: 3 inside the fence + 2 in inline math
      assert.equal(normalized.match(/\$\$/g)?.length, 5);
    });

    it("leaves inline math and plain prose untouched", () => {
      const input = "text $x = 1$ and $$a + b$$ more";
      assert.equal(normalizeDisplayMath(input), input);
    });

    it("does not treat a glued opener with mid-line $$ as a block", () => {
      const input = "$$x$$ and text";
      assert.equal(normalizeDisplayMath(input), input);
    });
  });

  describe("\\[ … \\] blocks", () => {
    it("normalizes single-line brackets", () => {
      assert.equal(normalizeDisplayMath("\\[a + b\\]"), "$$\na + b\n$$");
    });

    it("keeps content indented when nested in a list item", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  \\[a + b\\]\n- next"),
        "- item:\n  $$\n  a + b\n  $$\n- next",
      );
    });

    it("normalizes multi-line brackets without double-indenting", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  \\[\n  x = y\n  \\]\n- next"),
        "- item:\n  $$\n  x = y\n  $$\n- next",
      );
    });
  });

  describe("inline \\( … \\) conversion", () => {
    it("converts inline latex to dollar math", () => {
      assert.equal(normalizeDisplayMath("Inline \\(a^2\\) and text"), "Inline $a^2$ and text");
    });

    it("does not convert inside markdown links, URLs or windows paths", () => {
      assert.equal(normalizeDisplayMath("see [x](https://a.b/\\(c\\))"), "see [x](https://a.b/\\(c\\))");
      assert.equal(normalizeDisplayMath("path C:\\dir\\(x\\) here"), "path C:\\dir\\(x\\) here");
    });
  });

  // ── Local invariants (desktop fork) ────────────────────────────────────────
  // MarkdownBody runs normalizeDisplayMath twice: once on the full text, then
  // once per stable streaming part. The transformation must be idempotent so
  // the second pass never rewrites the first pass's output.
  describe("idempotency (MarkdownBody double-normalize contract)", () => {
    const CASES = [
      "$$a + b$$",
      "- item:\n  $$a + b$$\n- next",
      "$$\n\\frac{a}{b} = c\n<d$$\n\nafter",
      "$$\nx = y\nz = w$$\n\nafter",
      "- item:\n  $$\nx = y\n  $$\n- next",
      "- first\n  $$x = y\n- second\n  $$z = w$$\n- third",
      "\\[a + b\\]",
      "- item:\n  \\[a + b\\]\n- next",
      "```\n$$ not math $$\n$$\n```\n\nreal $$x = 1$$ end",
      "text $x = 1$ and $$a + b$$ more",
      "$$x$$ and text",
      "Inline \\(a^2\\) and $b^2$",
      "$$\n\\frac{a}{b}\n$$\n\nend",
      "> quote with $$x = y$$\n- list\n  - sub $$a = b$$",
      "plain text, no math at all",
      "",
      "$$x = 1\n\ny = 2$$",
      "multi\n\n$$ unclosed\nnever closed",
      // streaming-tail-like fragments (unterminated math while typing)
      "$$",
      "$$\nx = ",
      "\\[",
      "\\[x = ",
      "some text $$",
      "- item:\n  $$x = y",
      "$$\nx = 1",
      "$$\n\n$$x = 2",
    ];

    it("normalize(normalize(x)) === normalize(x) for all supported shapes", () => {
      for (const input of CASES) {
        const once = normalizeDisplayMath(input);
        assert.equal(normalizeDisplayMath(once), once, `not idempotent for input: ${JSON.stringify(input)}`);
      }
    });
  });

  // splitStableParts (lib/markdown-incremental.ts) mirrors normalizeDisplayMath's
  // code-fence state machine. Re-normalizing the split parts must leave them
  // unchanged so the streaming pipeline (full-text normalize → split → per-part
  // normalize) is stable.
  describe("streaming split contract", () => {
    it("keeps local exports and mention sanitize schema intact", async () => {
      const source = await readFile(new URL("./markdown.ts", import.meta.url), "utf-8");
      assert.match(source, /export function headingId/);
      assert.match(source, /"className", \/\^mention-\//);
      assert.match(source, /data-mention-kind/);
    });

    it("re-normalizing stable parts is a no-op", async () => {
      const { splitStableParts } = await import("./markdown-incremental.ts");
      const inputs = [
        "para1\n\n$$x = y$$\n\npara2",
        "- list\n  $$a = b$$\n- next item\n\nnext para",
        "$$\n\\frac{a}{b} = c\n<d$$\n\nafter",
        "text $x = 1$ and $$a + b$$ more\n\nmore text",
        "```ts\nconst $$ = 1;\n$$\n```\n\n$$real = x$$\n",
        "\\[a + b\\]\n\nnext",
        "- item:\n  $$\n  x = y\n  $$\n- next\n\nend",
      ];
      for (const input of inputs) {
        const normalized = normalizeDisplayMath(input);
        const parts = splitStableParts(normalized);
        for (const part of parts) {
          assert.equal(normalizeDisplayMath(part.text), part.text, `part changed: ${JSON.stringify(part.text)}`);
        }
      }
    });
  });
});
