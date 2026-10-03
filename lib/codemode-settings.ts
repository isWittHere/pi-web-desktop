import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { isToolModifier, resolveDefaultToolEntries } from "./powershell-settings";
import { getPowerShellSettingsPath } from "./powershell-settings";
import { getProjectTrustStatus } from "./project-trust";
import { PRESET_DEFAULT } from "./tool-presets";

/** How the user wants the codemode tool activated. */
export type CodemodeChoice = "automatic" | "always";
/** `on`: codemode is one more callable tool. `only`: direct tool calls must route through it. */
export type CodemodeMode = "on" | "only";

/** Default for the codemode inline budget, in estimated tokens (mirrors the SDK). */
export const DEFAULT_CODEMODE_INLINE_BUDGET = 3000;

const CODEMODE_TOOL_NAME = "codemode";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The process-level self-test result B's `runCodemodeSelfTest()` writes once
 * per server process; the settings route surfaces it to the panel.
 */
const SANDBOX_RESULT_STORE = Symbol.for("@agegr/pi-web/codemode-sandbox-result/v1");

export interface CodemodeSandboxResult {
  available: boolean;
  error?: string;
}

interface SandboxStore {
  result: CodemodeSandboxResult | null;
}

function sandboxStore(): SandboxStore {
  const store = globalThis as Record<symbol, SandboxStore | undefined>;
  if (!store[SANDBOX_RESULT_STORE]) store[SANDBOX_RESULT_STORE] = { result: null };
  return store[SANDBOX_RESULT_STORE];
}

/** Record the codemode sandbox self-test outcome for this server process. */
export function setCodemodeSandboxResult(result: CodemodeSandboxResult): void {
  sandboxStore().result = result;
}

/** The last self-test outcome, or an explicit "not run yet" placeholder. */
export function getCodemodeSandboxResult(): CodemodeSandboxResult {
  return sandboxStore().result ?? { available: false, error: "The codemode self test has not run yet" };
}

/** The codemode choice a settings layer's defaultTools encodes: `+codemode` pins "always". */
export function readCodemodeChoice(settings: Record<string, unknown>): CodemodeChoice {
  const raw = settings.defaultTools;
  if (raw === undefined) return "automatic";
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    throw new Error("Invalid settings.json: defaultTools must be an array of strings");
  }
  // The effective resolved list is the truth: a `+codemode` modifier, a plain
  // codemode entry, and a modifier-only list that pi-web's writer normalized
  // all mean the tool is pinned on.
  return resolveDefaultToolEntries(raw as string[]).includes(CODEMODE_TOOL_NAME) ? "always" : "automatic";
}

function parseSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid settings.json: expected an object");
  return parsed;
}

/** The raw defaultTools entries, or undefined when the setting is absent. */
function rawDefaultTools(settings: Record<string, unknown>): string[] | undefined {
  if (settings.defaultTools === undefined) return undefined;
  if (
    !Array.isArray(settings.defaultTools)
    || settings.defaultTools.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("Invalid settings.json: defaultTools must be an array of strings");
  }
  return settings.defaultTools as string[];
}

function readCodemodeSection(settings: Record<string, unknown>): Record<string, unknown> {
  const section = settings.codemode;
  if (section === undefined) return {};
  if (!isRecord(section)) throw new Error("Invalid settings.json: codemode must be an object");
  return section;
}

export interface CodemodeConfig {
  mode: CodemodeMode;
  inlineBudget: number;
}

/** The stored codemode section, normalized to the SDK's defaults. */
function normalizeCodemodeConfig(section: Record<string, unknown>): CodemodeConfig {
  const mode = section.mode === "only" ? "only" : "on";
  const budget = section.inlineBudget;
  const inlineBudget = typeof budget === "number" && Number.isFinite(budget) && budget >= 0
    ? budget
    : DEFAULT_CODEMODE_INLINE_BUDGET;
  return { mode, inlineBudget };
}

export async function readCodemodeConfig(
  settingsPath = getPowerShellSettingsPath(),
): Promise<CodemodeConfig> {
  if (!existsSync(settingsPath)) return { mode: "on", inlineBudget: DEFAULT_CODEMODE_INLINE_BUDGET };
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    return normalizeCodemodeConfig(readCodemodeSection(parseSettings(settingsPath)));
  } finally {
    await release();
  }
}

/**
 * The codemode choice stored at a settings path (the global agent settings by
 * default, or a project's `.pi/settings.json`), read under the shared lock.
 */
export async function readCodemodeChoiceFromDisk(
  settingsPath = getPowerShellSettingsPath(),
): Promise<CodemodeChoice> {
  if (!existsSync(settingsPath)) return "automatic";
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    return readCodemodeChoice(parseSettings(settingsPath));
  } finally {
    await release();
  }
}

/**
 * Edit the codemode section (mode / inlineBudget) under the same lock the
 * PowerShell toggle and the choice writer use, so concurrent panel writes
 * cannot lose each other's settings.json changes.
 */
export async function writeCodemodeConfig(
  patch: { mode?: CodemodeMode; inlineBudget?: number },
  settingsPath = getPowerShellSettingsPath(),
): Promise<CodemodeConfig> {
  if (patch.mode !== undefined && patch.mode !== "on" && patch.mode !== "only") {
    throw new Error("Invalid codemode mode: expected \"on\" or \"only\"");
  }
  if (patch.inlineBudget !== undefined
    && (!Number.isFinite(patch.inlineBudget) || patch.inlineBudget < 0)
  ) {
    throw new Error("Invalid codemode inlineBudget: expected a non-negative number");
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  try {
    writeFileSync(settingsPath, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    const section = readCodemodeSection(settings);
    settings.codemode = {
      ...section,
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.inlineBudget !== undefined ? { inlineBudget: patch.inlineBudget } : {}),
    };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    chmodSync(settingsPath, 0o600);
    return normalizeCodemodeConfig(settings.codemode as Record<string, unknown>);
  } finally {
    await release();
  }
}

/**
 * Write the codemode activation choice into the global defaultTools. The list
 * is edited after `resolveDefaultToolEntries`, so a `+codemode` on a
 * modifier-only list lands on pi's defaults instead of collapsing into a
 * plain codemode-only list, and "automatic" removes the resolved entry rather
 * than leaving a stale modifier behind.
 */
export async function writeCodemodeChoice(
  choice: CodemodeChoice,
  settingsPath = getPowerShellSettingsPath(),
): Promise<CodemodeChoice> {
  mkdirSync(dirname(settingsPath), { recursive: true });
  try {
    writeFileSync(settingsPath, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    const raw = rawDefaultTools(settings);
    // An absent defaultTools resolves to pi's defaults; editing that base list
    // keeps the plain write equivalent to appending a `+codemode` modifier.
    const resolved = raw === undefined ? [...PRESET_DEFAULT] : resolveDefaultToolEntries(raw);
    let next: string[];
    if (choice === "always") {
      next = resolved.includes(CODEMODE_TOOL_NAME) ? resolved : [...resolved, CODEMODE_TOOL_NAME];
    } else {
      next = resolved.filter((name) => name !== CODEMODE_TOOL_NAME);
    }
    settings.defaultTools = next;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    chmodSync(settingsPath, 0o600);
    return readCodemodeChoice(settings);
  } finally {
    await release();
  }
}

/**
 * The trusted project's settings.json entry that governs the codemode choice,
 * or undefined when the global file stays authoritative. Plain names replace
 * the inherited defaultTools list and ±codemode modifiers decide codemode
 * directly, so either means a project override; other modifiers merely append.
 */
export function findProjectCodemodeOverride(
  cwd: string,
  agentDir = getAgentDir(),
): string | undefined {
  if (!getProjectTrustStatus(cwd, agentDir).trusted) return undefined;
  const file = join(cwd, ".pi", "settings.json");
  if (!existsSync(file)) return undefined;
  try {
    const tools = parseSettings(file).defaultTools;
    if (!Array.isArray(tools)) return undefined;
    const governs = tools.some(
      (entry) => typeof entry === "string"
        && (!isToolModifier(entry) || entry === `+${CODEMODE_TOOL_NAME}` || entry === `-${CODEMODE_TOOL_NAME}`),
    );
    return governs ? file : undefined;
  } catch {
    // An unreadable project file cannot silently shadow the global choice.
    return undefined;
  }
}
