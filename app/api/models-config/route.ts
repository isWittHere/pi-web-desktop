import { NextResponse } from "next/server";
import { ModelsConfigWriteError, readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { findBuiltinModelConflicts } from "@/lib/builtin-models";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsConfig(body);
    // models[] 对同名内置模型是"整条替换"（provider-composer 语义），
    // 内置 thinkingLevelMap/compat 会被丢弃——保存后给出警告引导使用 modelOverrides。
    const providers = (body.providers ?? {}) as Record<string, { models?: { id?: string }[] }>;
    const conflicts = findBuiltinModelConflicts(providers);
    return NextResponse.json({
      success: true,
      ...(conflicts.length > 0 ? { warnings: conflicts } : {}),
    });
  } catch (error) {
    if (error instanceof ModelsConfigWriteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
