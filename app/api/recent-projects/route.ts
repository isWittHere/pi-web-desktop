import { NextResponse } from "next/server";
import { collectRecentProjects, type RecentProject } from "@/lib/recent-projects";

export const dynamic = "force-dynamic";

/**
 * GET /api/recent-projects
 *
 * Recents from other editors/agents (VS Code family, Zed, Claude Code,
 * Codex, OpenCode), merged and sorted by last use. Read-only best-effort:
 * sources that are missing or unreadable are skipped silently.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const projects = await collectRecentProjects();
    return NextResponse.json({ projects });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), projects: [] as RecentProject[] },
      { status: 500 },
    );
  }
}
