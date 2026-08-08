import { encodeFilePathForApi } from "./file-paths";
import { resolveLocalFileHref } from "./file-links";

/**
 * Resolve a markdown image src to a renderable URL.
 *
 * Local filesystem paths (relative to the markdown file / cwd, absolute
 * paths, and `file:` URIs) are rewritten to the `/api/files` read endpoint so
 * the browser can actually fetch them. http(s) URLs and data:image URIs pass
 * through unchanged. Anything else (`javascript:`, `data:text/html`, …)
 * returns null so the caller can drop the image.
 *
 * This is the security gate that replaces the sanitize protocol check for
 * `img src`: the sanitize schema (lib/markdown.ts) deliberately lets `src`
 * through untouched so local paths survive to the render component, and only
 * the URL shapes handled here are ever emitted into the DOM.
 */
export function resolveMarkdownImageSrc(
  src: string | Blob | undefined,
  baseDir?: string,
  relativeRoot = baseDir,
  sessionId?: string | null,
): string | null {
  if (typeof src !== "string" || !src) return null;

  const localPath = resolveLocalFileHref(src, baseDir, relativeRoot);
  if (localPath) {
    const searchParams = new URLSearchParams({ type: "read" });
    if (sessionId) searchParams.set("sessionId", sessionId);
    return `/api/files/${encodeFilePathForApi(localPath)}?${searchParams.toString()}`;
  }

  // Same-origin app endpoints are trusted.
  if (/^\/(?:api|_next)\//.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  if (/^data:image\//i.test(src)) return src;

  return null;
}
