export function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

export function encodeFilePathForApi(filePath: string): string {
  return normalizeFilePathSlashes(filePath)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function getFileName(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function getFileDirectory(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return "";
  if (lastSlash === 0) return "/";
  if (lastSlash === 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, lastSlash);
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  const normalizedFile = normalizeFilePathSlashes(filePath);
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  if (normalizedFile.startsWith(normalizedCwd + "/")) {
    return normalizedFile.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

export function joinFilePath(parent: string, child: string): string {
  return `${normalizeFilePathSlashes(parent).replace(/\/$/, "")}/${child}`;
}

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

/**
 * Reassemble an API catch-all path into a filesystem path. A bare drive
 * letter ("C:") is the drive root, but the absolute-path check requires a
 * separator after the colon, so it must be normalized to "C:/" explicitly —
 * otherwise it degrades into the POSIX-looking "/C:" and every stat/readdir
 * under it fails with ENOENT.
 */
export function filePathFromSegments(segments: string[]): string {
  const slashJoined = normalizeFilePathSlashes(segments.join("/"));
  if (WINDOWS_ABSOLUTE_RE.test(slashJoined)) return slashJoined;
  if (/^[a-zA-Z]:$/.test(slashJoined)) return `${slashJoined}/`;
  return "/" + slashJoined.replace(/^\/+/, "");
}
