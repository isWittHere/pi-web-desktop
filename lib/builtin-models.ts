/**
 * 内置（bundled）模型目录：从 pi-ai 的 providers/data/*.json 读取 provider → 内置模型 id 集合。
 *
 * 用途：检测用户 models.json 的 `models[]` 条目是否与内置模型同名
 * （provider-composer 对 `models[]` 是"整条替换"而非合并，会导致内置
 * thinkingLevelMap / compat 丢失），从而在保存时给出警告。
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

interface BuiltinCatalog {
  providerModels: Map<string, Set<string>>;
}

declare global {
  var __piBuiltinModels: BuiltinCatalog | undefined;
}

function providerDataDir(): string {
  // pi-ai 的 providers/data 目录（node_modules 内部，作为只读参考数据源）。
  return join(
    process.cwd(),
    "node_modules",
    "@earendil-works",
    "pi-ai",
    "dist",
    "providers",
    "data",
  );
}

function loadCatalog(): BuiltinCatalog {
  const providerModels = new Map<string, Set<string>>();
  try {
    const dir = providerDataDir();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const providerId = file.replace(/\.json$/, "");
      const ids = new Set<string>();
      try {
        const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
        for (const api of Object.values(data as Record<string, unknown>)) {
          if (typeof api !== "object" || api === null) continue;
          for (const group of Object.values(api as Record<string, unknown>)) {
            if (typeof group !== "object" || group === null) continue;
            const entry = group as { id?: unknown; models?: { id?: unknown }[] };
            if (Array.isArray(entry.models)) {
              for (const m of entry.models) if (typeof m?.id === "string") ids.add(m.id);
            } else if (typeof entry.id === "string") {
              ids.add(entry.id);
            }
          }
        }
      } catch {
        // 单个 provider 数据损坏不影响其余。
      }
      if (ids.size > 0) providerModels.set(providerId, ids);
    }
  } catch {
    // 目录不可读（打包后路径变化）→ 返回空目录，警告功能静默降级。
  }
  return { providerModels };
}

export function getBuiltinModelCatalog(): Map<string, Set<string>> {
  if (!globalThis.__piBuiltinModels) {
    globalThis.__piBuiltinModels = loadCatalog();
  }
  return globalThis.__piBuiltinModels.providerModels;
}

/** 判断 models.json 的 models[] 条目是否覆盖同名内置模型（返回冲突描述列表）。 */
export function findBuiltinModelConflicts(providers: Record<string, { models?: { id?: string }[] }>): string[] {
  const catalog = getBuiltinModelCatalog();
  const conflicts: string[] = [];
  for (const [providerName, provider] of Object.entries(providers)) {
    const builtinIds = catalog.get(providerName);
    if (!builtinIds || !provider?.models?.length) continue;
    for (const model of provider.models) {
      if (typeof model?.id === "string" && builtinIds.has(model.id)) {
        conflicts.push(`${providerName}/${model.id}`);
      }
    }
  }
  return conflicts;
}
