import { lstatSync } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitFileDiff } from "@/lib/git-changes";
import { hasParentDirectorySegment } from "@/lib/path-security";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

/**
 * Authorize a diff target. A deleted file (and its parents) may be absent, so the
 * nearest existing entry is checked instead — but never past a dangling link or an
 * access error, and never outside the allowed roots. A directory junction inside a
 * repository can otherwise expose an outside file through an apparently local path.
 */
function isDiffPathAllowed(filePath: string, allowedRoots: Set<string>): boolean {
  if (hasParentDirectorySegment(filePath)) return false;
  let candidate = filePath;
  while (isFilePathAllowed(candidate, allowedRoots)) {
    try {
      lstatSync(candidate);
      return isExistingFilePathAllowed(candidate, allowedRoots);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
  return false;
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const requestedCwd = params.get("cwd")?.trim() ?? "";
    const requestedPath = params.get("path")?.trim() ?? "";
    if (!isAbsolutePath(requestedCwd) || !isAbsolutePath(requestedPath)) {
      return NextResponse.json({ error: "cwd and path must be absolute paths" }, { status: 400 });
    }

    const cwd = path.resolve(requestedCwd);
    const filePath = path.resolve(requestedPath);
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots) || !isFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // The cwd must resolve inside an allowed root, and so must the target: a
    // directory junction inside a repository can otherwise expose an outside
    // file through an apparently local path. A deleted file is authorized
    // through its nearest existing ancestor (isDiffPathAllowed).
    if (!isExistingFilePathAllowed(cwd, allowedRoots) || !isDiffPathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    try {
      if (!(await stat(cwd)).isDirectory()) {
        return NextResponse.json({ error: "cwd must be a directory" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    // The requested file can be deleted. getGitFileDiff verifies that it is a
    // changed path inside the repository before returning a patch.
    return NextResponse.json(await getGitFileDiff(cwd, filePath));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
