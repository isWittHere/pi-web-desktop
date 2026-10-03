// Path predicates shared by file-access and path-security. Containment checks
// re-normalize their inputs (see path-security.ts), so this module only hosts
// the notion of "absolute" that must agree across separator styles.

import { normalize, parse, sep } from "path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

/** Convert a path to forward slashes for separator-insensitive keys and display. */
export function toSlashPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function normalizeForComparison(p: string): string {
  const normalized = normalize(p);
  const rootLength = parse(normalized).root.length;
  let end = normalized.length;
  while (end > rootLength && normalized[end - 1] === sep) end--;
  return normalized.slice(0, end);
}

/**
 * Whether two paths denote the same location, tolerating separator style and —
 * on Windows, where the filesystem is case-insensitive — case, including the
 * drive letter (`d:\repo` vs `D:\repo`).
 *
 * Compares lexically: callers wanting symlinks resolved should realpath first.
 */
export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const normalizedA = normalizeForComparison(a);
  const normalizedB = normalizeForComparison(b);
  if (process.platform === "win32") {
    return normalizedA.toLowerCase() === normalizedB.toLowerCase();
  }
  return normalizedA === normalizedB;
}
