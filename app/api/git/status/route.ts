import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitStatus } from "@/lib/git-changes";
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
    const requestedCwd = new URL(request.url).searchParams.get("cwd")?.trim() ?? "";
    if (!isAbsolutePath(requestedCwd)) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }

    const cwd = path.resolve(requestedCwd);
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    try {
      if (!(await stat(cwd)).isDirectory()) {
        return NextResponse.json({ error: "Not a directory" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    return NextResponse.json(await getGitStatus(cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
