import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { searchSessionContents } from "@/lib/session-search";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { samePath } from "@/lib/path-match";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  // Optional project-root scope: when set, only sessions of that project
  // (all of its worktrees, keyed by the resolved projectRoot exactly like
  // the sidebar groups them) are searched. Unset = search every workspace,
  // matching the sidebar which shows all rows without a selected workspace.
  const project = (url.searchParams.get("project") ?? "").trim();
  const headers = { "Cache-Control": "no-store" };
  if (query.length > 200) {
    return NextResponse.json({ error: "Search query exceeds 200 characters" }, { status: 400, headers });
  }
  try {
    // Paths come only from the same catalog used by the sidebar.
    let sessions = query && !request.signal.aborted ? await listAllSessions() : [];
    if (project) sessions = sessions.filter((s: SessionInfo) => samePath(workspaceKeyOf(s), project));
    return NextResponse.json(await searchSessionContents(sessions, query, request.signal), { headers });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500, headers });
  }
}
