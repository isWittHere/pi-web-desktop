import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitCommitFiles, getGitLog } from "@/lib/git-graph";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const DEFAULT_LOG_LIMIT = 400;
const MAX_LOG_LIMIT = 2000;

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const requestedCwd = searchParams.get("cwd")?.trim() ?? "";
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

    const commit = searchParams.get("commit")?.trim();
    if (commit) {
      return NextResponse.json(await getGitCommitFiles(cwd, commit));
    }

    const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_LOG_LIMIT)
      : DEFAULT_LOG_LIMIT;
    return NextResponse.json(await getGitLog(cwd, limit));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
