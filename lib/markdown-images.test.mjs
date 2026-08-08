import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveMarkdownImageSrc } = await jiti.import("./markdown-images.ts");

const CWD = "C:/Users/aftersix/projects/pi-web-main";

describe("resolveMarkdownImageSrc", () => {
  describe("local paths are rewritten to /api/files", () => {
    it("rewrites a relative path against the base dir", () => {
      assert.equal(
        resolveMarkdownImageSrc("./images/a.png", `${CWD}/docs`),
        `/api/files/${encodeURIComponent("C:")}/Users/aftersix/projects/pi-web-main/docs/images/a.png?type=read`,
      );
    });

    it("rewrites a relative path with cwd as base", () => {
      const resolved = resolveMarkdownImageSrc("img/b.png", CWD);
      assert.match(resolved ?? "", /^\/api\/files\/C%3A\/Users\/aftersix\/projects\/pi-web-main\/img\/b\.png\?type=read$/);
    });

    it("rejects a relative path escaping the relative root", () => {
      // baseDir is the markdown dir, relativeRoot is cwd: a ../ climb out of
      // cwd must not resolve.
      const resolved = resolveMarkdownImageSrc("../../../outside.png", `${CWD}/docs`, CWD);
      assert.equal(resolved, null);
    });

    it("rewrites an absolute Windows path", () => {
      const resolved = resolveMarkdownImageSrc("C:/other/x.png", CWD);
      assert.match(resolved ?? "", /^\/api\/files\/C%3A\/other\/x\.png\?type=read$/);
    });

    it("rewrites a file: URI", () => {
      const resolved = resolveMarkdownImageSrc("file:///C:/other/x.png", CWD);
      assert.match(resolved ?? "", /^\/api\/files\/C%3A\/other\/x\.png\?type=read$/);
    });

    it("encodes spaces and non-ASCII in file names", () => {
      const resolved = resolveMarkdownImageSrc("./我的 图.png", CWD);
      assert.match(resolved ?? "", /%E6%88%91%E7%9A%84%20%E5%9B%BE\.png\?type=read$/);
    });

    it("carries the session id when provided", () => {
      const resolved = resolveMarkdownImageSrc("a.png", CWD, CWD, "sess-1");
      assert.match(resolved ?? "", /\?type=read&sessionId=sess-1$/);
    });
  });

  describe("safe remote sources pass through", () => {
    it("keeps http(s) URLs unchanged", () => {
      assert.equal(resolveMarkdownImageSrc("https://example.com/a.png", CWD), "https://example.com/a.png");
      assert.equal(resolveMarkdownImageSrc("http://example.com/a.png", CWD), "http://example.com/a.png");
    });

    it("keeps data:image URIs unchanged", () => {
      assert.equal(resolveMarkdownImageSrc("data:image/png;base64,iVBORw0KGgo=", CWD), "data:image/png;base64,iVBORw0KGgo=");
    });

    it("keeps same-origin /api and /_next URLs", () => {
      assert.equal(resolveMarkdownImageSrc("/api/files/x?type=read", CWD), "/api/files/x?type=read");
      assert.equal(resolveMarkdownImageSrc("/_next/image?url=x", CWD), "/_next/image?url=x");
    });
  });

  describe("unsafe sources are dropped", () => {
    it("drops javascript: URLs", () => {
      assert.equal(resolveMarkdownImageSrc("javascript:alert(1)", CWD), null);
    });

    it("drops data:text/html URIs", () => {
      assert.equal(resolveMarkdownImageSrc("data:text/html,<script>alert(1)</script>", CWD), null);
    });

    it("drops empty or non-string src", () => {
      assert.equal(resolveMarkdownImageSrc(undefined, CWD), null);
      assert.equal(resolveMarkdownImageSrc("", CWD), null);
    });
  });
});
