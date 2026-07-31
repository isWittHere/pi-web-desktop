import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitFileDiff } from "@/lib/git-changes";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
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
