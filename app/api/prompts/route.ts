import { NextResponse } from "next/server";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

// GET /api/prompts?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings
// prompt paths, package prompts, and ~/.pi/agent/prompts + .pi/prompts are
// all included, exactly like /api/skills does for skills.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const agentDir = getAgentDir();
    const loader = new DefaultResourceLoader({ cwd, agentDir });
    await loader.reload(projectTrustReloadOptions(cwd, agentDir));
    const { prompts, diagnostics } = loader.getPrompts();

    return NextResponse.json({
      prompts: prompts.map((template) => ({
        name: template.name,
        description: template.description,
        argumentHint: template.argumentHint,
        filePath: template.filePath,
        source: template.sourceInfo?.source,
        scope: template.sourceInfo?.scope,
        content: template.content,
      })),
      diagnostics,
      projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
    });
  } catch (error) {
    console.error("Failed to list prompts:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}