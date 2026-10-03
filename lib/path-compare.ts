import { realpathSync } from "fs";
import { resolve } from "path";

function realPathOrSelf(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

/** git prints POSIX separators on all platforms while Node's fs returns
 *  native ones on Windows; drive/folder case may also differ. Resolve both
 *  sides before comparing (handles `..`, trailing slashes, UNC paths) and
 *  compare case-insensitively on Windows so top-level detection — and with
 *  it the worktree switcher — works there too. POSIX behavior is unchanged:
 *  resolve is idempotent for absolute paths. Links are resolved first: git
 *  reports real paths (macOS's /var is a link to /private/var, Windows has
 *  junctions), so an unresolved caller path would fail to match. realpath
 *  never changes an already-resolved plain path, so callers comparing plain
 *  paths see identical results. */
export function sameResolvedPath(a: string, b: string): boolean {
  const ra = resolve(realPathOrSelf(a));
  const rb = resolve(realPathOrSelf(b));
  if (process.platform === "win32") return ra.toLowerCase() === rb.toLowerCase();
  return ra === rb;
}
