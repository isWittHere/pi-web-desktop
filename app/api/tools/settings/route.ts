import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";

export const dynamic = "force-dynamic";

// GET /api/tools/settings — report whether the PowerShell shell tool is enabled.
export async function GET() {
  try {
    return NextResponse.json({
      isWindows: process.platform === "win32",
      powerShellEnabled: await readPowerShellToolEnabled(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// PUT /api/tools/settings — persist the PowerShell tool preference. Only valid on Windows.
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  if (process.platform !== "win32") {
    return NextResponse.json({ error: "PowerShell tool settings are only available on Windows" }, { status: 404 });
  }

  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    return NextResponse.json({
      isWindows: true,
      powerShellEnabled: await writePowerShellToolEnabled(body.enabled),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}