// Path predicates shared by file-access and path-security. Containment checks
// re-normalize their inputs (see path-security.ts), so this module only hosts
// the notion of "absolute" that must agree across separator styles.

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

/** Convert a path to forward slashes for separator-insensitive keys and display. */
export function toSlashPath(p: string): string {
  return p.replace(/\\/g, "/");
}

