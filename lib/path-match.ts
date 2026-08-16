/**
 * Platform-aware path identity helpers.
 *
 * Windows paths are case-insensitive, and external sources (VS Code, Zed,
 * OpenCode, Claude Code, Codex …) spell paths differently on every axis:
 * drive-letter case ("e:/Dev" vs "E:/Dev") AND separator style ("E:\Dev"
 * vs "E:/Dev" — pi's own session records use backslashes). Every place that
 * compares project/cwd paths for workspace identity must fold case and
 * separators on Windows so entries from the lobby and the session list
 * resolve to the same workspace.
 */

/** True on Windows (works in both browser and server code). */
export function isWindowsPlatform(): boolean {
  if (typeof navigator !== "undefined") {
    return /win/i.test(navigator.platform ?? navigator.userAgent);
  }
  return process.platform === "win32";
}

/** Windows-only: unify separator style and case for comparison. */
export function foldWindowsKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/** Case- and separator-insensitive path equality on Windows; exact elsewhere. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (isWindowsPlatform()) return foldWindowsKey(a) === foldWindowsKey(b);
  return a === b;
}

/** Normalize a path for use as a stable map key: Windows drive letters are
 *  uppercased and separators unified ("e:\Dev", "e:/Dev", "E:/Dev" all share
 *  one key). POSIX paths are returned unchanged. */
export function normalizePathKey(p: string): string {
  if (!isWindowsPlatform()) return p;
  return p.replace(/\\/g, "/").replace(/^([a-z]):/, (_m, d: string) => d.toUpperCase() + ":");
}
