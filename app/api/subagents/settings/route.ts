import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readSubagentSettings,
  writeBuiltInSubagentsEnabled,
  writeSubagentMaxConcurrent,
} from "@/lib/subagent-settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    const settings = readSubagentSettings();
    return NextResponse.json({ enabled: settings.builtInEnabled, maxConcurrent: settings.maxConcurrent });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { enabled?: unknown; maxConcurrent?: unknown };
    if (body.enabled === undefined && body.maxConcurrent === undefined) {
      return NextResponse.json({ error: "enabled or maxConcurrent is required" }, { status: 400 });
    }
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    if (body.maxConcurrent !== undefined && typeof body.maxConcurrent !== "number") {
      return NextResponse.json({ error: "maxConcurrent must be a number" }, { status: 400 });
    }
    let settings = readSubagentSettings();
    if (body.enabled !== undefined) settings = writeBuiltInSubagentsEnabled(body.enabled);
    if (body.maxConcurrent !== undefined) settings = writeSubagentMaxConcurrent(body.maxConcurrent);
    return NextResponse.json({ enabled: settings.builtInEnabled, maxConcurrent: settings.maxConcurrent });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
