import { NextResponse } from "next/server";
import { resolve } from "path";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";
import {
  findProjectCodemodeOverride,
  getCodemodeSandboxResult,
  readCodemodeChoiceFromDisk,
  writeCodemodeChoice,
  type CodemodeChoice,
} from "@/lib/codemode-settings";

export const dynamic = "force-dynamic";

// GET /api/tools/settings — report the PowerShell shell-tool state, the codemode
// activation choice, and the codemode sandbox self-test result. An optional
// `cwd` reports the effective choice for a trusted project whose settings.json
// overrides the global defaultTools (its path comes back as `projectOverride`).
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd")?.trim();
    const projectOverride = cwd ? findProjectCodemodeOverride(resolve(cwd)) : undefined;
    // A governed-but-malformed project file must not break the whole read:
    // fall back to the global choice, the override path is still reported.
    let codemode: CodemodeChoice;
    try {
      codemode = projectOverride
        ? await readCodemodeChoiceFromDisk(projectOverride)
        : await readCodemodeChoiceFromDisk();
    } catch {
      codemode = await readCodemodeChoiceFromDisk();
    }
    const sandbox = getCodemodeSandboxResult();
    return NextResponse.json({
      isWindows: process.platform === "win32",
      powerShellEnabled: await readPowerShellToolEnabled(),
      codemode,
      sandboxAvailable: sandbox.available,
      ...(sandbox.error !== undefined ? { sandboxError: sandbox.error } : {}),
      ...(projectOverride !== undefined ? { projectOverride } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// PUT /api/tools/settings — persist the PowerShell tool preference (Windows
// only) and/or the codemode activation choice. When a trusted project's
// `.pi/settings.json` governs defaultTools, the global codemode write would be
// shadowed, so the request is refused with the overriding file's path (409).
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { enabled?: unknown; codemode?: unknown; cwd?: unknown };
    const hasEnabled = body.enabled !== undefined;
    const hasCodemode = body.codemode !== undefined;
    if (!hasEnabled && !hasCodemode) {
      return NextResponse.json({ error: "enabled or codemode is required" }, { status: 400 });
    }
    if (hasEnabled && typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    if (hasCodemode && body.codemode !== "automatic" && body.codemode !== "always") {
      return NextResponse.json(
        { error: "codemode must be \"automatic\" or \"always\"" },
        { status: 400 },
      );
    }

    const wantsPowerShell = hasEnabled;
    if (wantsPowerShell && process.platform !== "win32") {
      return NextResponse.json(
        { error: "PowerShell tool settings are only available on Windows" },
        { status: 404 },
      );
    }

    if (hasCodemode) {
      const cwd = typeof body.cwd === "string" && body.cwd.trim() ? resolve(body.cwd.trim()) : undefined;
      const overrideFile = cwd ? findProjectCodemodeOverride(cwd) : undefined;
      if (overrideFile) {
        return NextResponse.json({ file: overrideFile }, { status: 409 });
      }
    }

    if (wantsPowerShell) {
      await writePowerShellToolEnabled(body.enabled as boolean);
    }
    let codemode: CodemodeChoice | undefined;
    if (hasCodemode) {
      codemode = await writeCodemodeChoice(body.codemode as CodemodeChoice);
    }
    return NextResponse.json({
      isWindows: process.platform === "win32",
      powerShellEnabled: process.platform === "win32" ? await readPowerShellToolEnabled() : false,
      ...(codemode !== undefined ? { codemode } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
