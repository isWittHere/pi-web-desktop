import { NextResponse } from "next/server";
import { forgetThinkingLevel } from "@/lib/thinking-level-memory";
import { invalidateModelsCache } from "@/lib/models-cache";

// DELETE /api/thinking-level-memory — 清除某模型的 per-model 推理强度记忆
// Body: { modelKey: "provider/modelId" }
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { modelKey?: unknown };
    if (typeof body?.modelKey !== "string" || !body.modelKey.includes("/")) {
      return NextResponse.json({ error: "modelKey (provider/modelId) is required" }, { status: 400 });
    }
    forgetThinkingLevel(body.modelKey);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
