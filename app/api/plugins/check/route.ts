import { NextResponse } from "next/server";
import type { PluginScope } from "@/lib/api-types";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { checkPluginUpdates } from "@/lib/plugin-updates";

export const dynamic = "force-dynamic";

// POST /api/plugins/check body: { cwd, source?, scope? }
// Omitting source/scope checks every configured package at once.
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      cwd?: unknown;
      source?: unknown;
      scope?: unknown;
    };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const source = typeof body.source === "string" ? body.source : undefined;
    const scope = body.scope === "global" || body.scope === "project"
      ? body.scope as PluginScope
      : undefined;
    if ((source && !scope) || (!source && scope)) {
      return NextResponse.json({ error: "source and scope must be provided together" }, { status: 400 });
    }

    const updates = await checkPluginUpdates(cwd, source && scope ? { source, scope } : undefined);
    if (source && scope && updates.length === 0) {
      return NextResponse.json({ error: "Configured package not found" }, { status: 404 });
    }

    return NextResponse.json({ updates });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
