import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillToggleResult } from "@/lib/api-types";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { setDisableModelInvocation } from "@/lib/skill-frontmatter";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await loadSkillsWithInstallInfo(cwd));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** The roots a skill file may be edited in: the allowed roots plus the global skill roots. */
async function getSkillEditRoots(cwd: string): Promise<Set<string>> {
  const allowedRoots = new Set(await getAllowedFileRoots());
  allowedRoots.add(cwd);
  const agentDir = getAgentDir();
  allowedRoots.add(agentDir);
  // Globally installed skills live in ~/.agents/skills and are symlinked into
  // the agent's skills dir; isFilePathAllowed resolves the symlink, so the real
  // target sits outside getAgentDir(). Allow the global skills root too (the
  // SDK always treats ~/.agents/skills as trusted).
  const globalSkillsDir = path.join(homedir(), ".agents", "skills");
  if (existsSync(globalSkillsDir)) allowedRoots.add(globalSkillsDir);
  return allowedRoots;
}

/**
 * Edits one SKILL.md, or returns the status and message that refused it.
 * `cwd`'s trust is checked by the caller; a project file under `cwd` is only
 * edited when project resources are trusted.
 */
function toggleSkillFile(
  filePath: string,
  disableModelInvocation: boolean,
  allowedRoots: Set<string>,
  cwd: string,
  projectResourcesTrusted: boolean,
): { status: number; error: string } | null {
  // Skills are SKILL.md or *.md files. The allowed roots also hold settings,
  // auth.json and project files, whose top a frontmatter edit would break.
  if (path.extname(filePath).toLowerCase() !== ".md") return { status: 400, error: "Not a skill file" };
  if (!existsSync(filePath)) return { status: 404, error: "file not found" };
  if (!isFilePathAllowed(filePath, allowedRoots)) {
    return { status: 403, error: "Access denied" };
  }
  if (!projectResourcesTrusted && isFilePathAllowed(filePath, new Set([cwd]))) {
    return { status: 403, error: "Project resources must be trusted before modifying project skills" };
  }
  const content = readFileSync(filePath, "utf8");
  const updated = setDisableModelInvocation(content, disableModelInvocation);
  // A skill already in the requested state keeps its file and mtime.
  if (updated !== content) writeFileSync(filePath, updated, "utf8");
  return null;
}

// PATCH /api/skills — toggle disable-model-invocation on SKILL.md files.
// Body: { cwd, filePath, disableModelInvocation } for one skill, or
// { cwd, filePaths, disableModelInvocation } for the panel's "Enable all" /
// "Disable all". A batch edits each file on its own and reports every one, so
// a skill the route refuses does not stop the rest.
export async function PATCH(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      cwd?: unknown;
      filePath?: unknown;
      filePaths?: unknown;
      disableModelInvocation?: unknown;
    };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const disableModelInvocation = body.disableModelInvocation;
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (typeof disableModelInvocation !== "boolean") {
      return NextResponse.json({ error: "disableModelInvocation must be boolean" }, { status: 400 });
    }
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const editRoots = await getSkillEditRoots(cwd);
    const projectResourcesTrusted = getProjectTrustStatus(cwd, getAgentDir()).trusted;

    if (body.filePaths !== undefined) {
      if (!Array.isArray(body.filePaths) || !body.filePaths.every((item) => typeof item === "string" && item)) {
        return NextResponse.json({ error: "filePaths must be a list of paths" }, { status: 400 });
      }
      const results: SkillToggleResult[] = [];
      for (const target of new Set(body.filePaths as string[])) {
        try {
          const refused = toggleSkillFile(target, disableModelInvocation, editRoots, cwd, projectResourcesTrusted);
          results.push(refused ? { filePath: target, error: refused.error } : { filePath: target });
        } catch (e) {
          results.push({ filePath: target, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return NextResponse.json({ results });
    }

    const filePath = typeof body.filePath === "string" ? body.filePath : "";
    if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });
    const refused = toggleSkillFile(filePath, disableModelInvocation, editRoots, cwd, projectResourcesTrusted);
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
