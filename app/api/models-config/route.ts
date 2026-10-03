import { NextResponse } from "next/server";
import { ModelsConfigReadError, ModelsConfigWriteError, readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { findBuiltinModelConflicts } from "@/lib/builtin-models";
import { bumpModelsVersion, invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(readModelsConfig());
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsConfig(body);
    // A model configuration change invalidates the /api/models cache immediately
    // and bumps the polled version so every open window (and every live session)
    // notices it. Without this the saved change stayed invisible for the cache
    // TTL — or until a restart for the session runtime snapshot.
    invalidateModelsCache();
    bumpModelsVersion();
    // models[] 对同名内置模型是"整条替换"（provider-composer 语义），
    // 内置 thinkingLevelMap/compat 会被丢弃——保存后给出警告引导使用 modelOverrides。
    const providers = (body.providers ?? {}) as Record<string, { models?: { id?: string }[] }>;
    const conflicts = findBuiltinModelConflicts(providers);
    return NextResponse.json({
      success: true,
      ...(conflicts.length > 0 ? { warnings: conflicts } : {}),
    });
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      // The file cannot be used, so it must not be replaced by this draft.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ModelsConfigWriteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
