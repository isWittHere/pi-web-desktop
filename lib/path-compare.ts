import { resolve } from "path";

/** git prints POSIX separators on all platforms while Node's fs returns
 *  native ones on Windows; drive/folder case may also differ. Resolve both
 *  sides before comparing (handles `..`, trailing slashes, UNC paths) and
 *  compare case-insensitively on Windows so top-level detection — and with
 *  it the worktree switcher — works there too. POSIX behavior is unchanged:
 *  resolve is idempotent for absolute paths. */
export function sameResolvedPath(a: string, b: string): boolean {
  const ra = resolve(a);
  const rb = resolve(b);
  if (process.platform === "win32") return ra.toLowerCase() === rb.toLowerCase();
  return ra === rb;
}
