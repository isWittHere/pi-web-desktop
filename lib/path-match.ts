/**
 * Platform-aware path identity helpers.
 *
 * Windows paths are case-insensitive, and external sources (VS Code, Zed,
 * OpenCode, Claude Code, Codex …) often spell paths differently ("e:/Dev"
 * vs "E:/Dev"). Every place that compares project/cwd paths for workspace
 * identity must fold case on Windows so entries from the lobby and the
 * session list resolve to the same workspace.
 */

/** True on Windows (works in both browser and server code). */
export function isWindowsPlatform(): boolean {
  if (typeof navigator !== "undefined") {
    return /win/i.test(navigator.platform ?? navigator.userAgent);
  }
  return process.platform === "win32";
}

/** Case-insensitive path equality on Windows; exact equality elsewhere. */
export function samePath(a: string, b: string): boolean {
  if (!a || !b) return a === b;
  if (isWindowsPlatform()) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Normalize a path for use as a stable map key: Windows drive letters are
 *  uppercased so all sources ("e:/Dev", "E:/Dev") share one key. POSIX paths
 *  are returned unchanged. */
export function normalizePathKey(p: string): string {
  if (!isWindowsPlatform()) return p;
  return p.replace(/^([a-z]):/, (_m, d: string) => d.toUpperCase() + ":");
}
