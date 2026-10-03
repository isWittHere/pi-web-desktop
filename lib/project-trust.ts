import { hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { ProjectTrustStatus } from "@/lib/api-types";

export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const requiresTrust = Boolean(cwd) && hasTrustRequiringProjectResources(cwd);
  if (!requiresTrust) return { requiresTrust: false, trusted: true };

  return {
    requiresTrust: true,
    trusted: new ProjectTrustStore(agentDir).get(cwd) === true,
  };
}

// Hot reload re-evaluates this module; globalThis keeps one warning per error per process.
const TRUST_READ_WARNINGS_KEY: symbol = Symbol.for("pi-web:project-trust-read-warnings");
const TRUST_READ_WARNINGS_MAX = 200;

/**
 * Whether the trust-gated configuration of the project at `cwd` (its
 * `.pi/mcp.json`) may be read right now: true only while the folder requires
 * trust and a decision, exact or inherited, trusts it. The folder's resources
 * and `trust.json` are read on every call, so a decision made anywhere (the
 * trust dialog, the pi CLI) and a `.pi/` resource that appeared since (`git
 * pull`, `pi mcp add -l`, the model's write tool) count at once. That is what
 * a per-wrapper `SettingsManager.isProjectTrusted()` cannot give: it is fixed
 * when the wrapper is built, `true` for a folder that needed no trust then,
 * and refreshed only on reload.
 *
 * A folder that requires no trust gets `false`, although its status reads
 * `trusted: true`. It has no `.pi/mcp.json` — that file alone makes a folder
 * require trust — so nothing is lost, while `true` would let the caller read a
 * file that landed between this check and its own read with no decision at all.
 *
 * A `trust.json` that cannot be read (unparsable, or still locked by another
 * process after the store's ~200 ms synchronous wait) counts as untrusted, with
 * one warning per distinct error.
 */
export function mayReadProjectConfigNow(cwd: string, agentDir: string): boolean {
  try {
    // Not getProjectTrustStatus(): that also reads trust.json for a folder that
    // requires no trust, which this answers false whatever its decision. Twice
    // per prompt, that would lock and read trust.json for nothing.
    if (!cwd || !hasTrustRequiringProjectResources(cwd)) return false;
    return new ProjectTrustStore(agentDir).get(cwd) === true;
  } catch (error) {
    const trustPath = join(agentDir, "trust.json");
    const message = error instanceof Error ? error.message : String(error);
    const store = globalThis as Record<symbol, Set<string> | undefined>;
    const warned = (store[TRUST_READ_WARNINGS_KEY] ??= new Set());
    const key = `${trustPath}\0${message}`;
    if (!warned.has(key)) {
      // The oldest goes, never the whole set, which would repeat every warning it held.
      if (warned.size >= TRUST_READ_WARNINGS_MAX) warned.delete(warned.values().next().value as string);
      warned.add(key);
      // A lock error does not name the file, so the path is always given.
      console.warn(`[pi-web] cannot read project trust from ${trustPath}; projects that need it count as untrusted meanwhile: ${message}`);
    }
    return false;
  }
}

export function trustProject(cwd: string, agentDir: string): ProjectTrustStatus {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return status;

  new ProjectTrustStore(agentDir).set(cwd, true);
  return { requiresTrust: true, trusted: true };
}

/**
 * Gates repository-controlled resources before the SDK imports or executes them.
 * This includes project extensions, project package resources, prompts, and
 * `.agents/skills`; global resources remain available.
 */
export function projectTrustReloadOptions(
  cwd: string,
  agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return undefined;

  const trustStore = new ProjectTrustStore(agentDir);
  return { resolveProjectTrust: async () => trustStore.get(cwd) === true };
}
