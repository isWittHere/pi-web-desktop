import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import type { CodemodeInlineBudgetSetting, CodemodeModeSetting } from "./api-types";
import { isToolModifier, resolveDefaultToolEntries } from "./powershell-settings";
import { getPowerShellSettingsPath } from "./powershell-settings";
import { getGlobalSettingsPath } from "./global-settings-file";
import { PROJECT_SETTINGS_MAX_BYTES, readRegularFileText } from "./regular-file";
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

// ---------------------------------------------------------------------------
// The ADR reader surface (Settings › MCP, ADR 0006 "Code mode"): what a
// settings layer's `codemode` object means to the codemode extension, with
// pi's own SettingsManager merging a trusted project's text over the global
// choice, and values pi ignores reported rather than normalized.
// ---------------------------------------------------------------------------

const CODEMODE = CODEMODE_TOOL_NAME;

type CodemodeKey = "mode" | "inlineBudget";

function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One key of `codemode`. A `codemode` that is not an object holds none, as `settings.codemode?.[key]` reads it. */
function codemodeValueOf(settings: Record<string, unknown>, key: CodemodeKey): unknown {
  return isSettingsObject(settings.codemode) ? settings.codemode[key] : undefined;
}

const INVALID_VALUE_MAX_CHARS = 60;

/** A value pi does not use, as JSON shortened for a notice. */
function invalidValueText(raw: unknown): string {
  const json = JSON.stringify(raw) ?? String(raw);
  return json.length > INVALID_VALUE_MAX_CHARS ? `${json.slice(0, INVALID_VALUE_MAX_CHARS - 1)}…` : json;
}

/** Global settings for each choice, reduced to what decides Code mode: other entries never do. */
const GLOBAL_SETTINGS_FOR: Record<CodemodeChoice, string | undefined> = {
  automatic: undefined,
  always: JSON.stringify({ defaultTools: [`+${CODEMODE}`] }),
};

/** Global and project settings texts merged by pi's own SettingsManager, as a trusted project's session merges them. */
function mergedSettings(globalText: string | undefined, projectText: string): SettingsManager {
  const texts = { global: globalText, project: projectText };
  const storage: Parameters<typeof SettingsManager.fromStorage>[0] = {
    withLock: (scope, fn) => {
      fn(texts[scope]);
    },
  };
  return SettingsManager.fromStorage(storage, { projectTrusted: true });
}

/** Whether a session starts with `codemode` active, merged and resolved by pi's own SettingsManager. */
function startsWithCodemode(globalText: string | undefined, projectText: string): boolean {
  return mergedSettings(globalText, projectText).getDefaultTools()?.includes(CODEMODE) === true;
}

/**
 * The Code mode a project's settings text gives its sessions when the global
 * choice no longer matters there, undefined when the global choice still
 * decides. A project `defaultTools` list with a plain tool name replaces the
 * global list, `+codemode` and all; one of only modifiers is appended to it,
 * so a `+codemode` or `-codemode` there has the last word. The SDK merges and
 * resolves both global choices with the project's text, so its rules apply
 * exactly, malformed values included; the two agreeing is what overriding
 * means. A text that does not parse reads as empty, as pi reads it.
 */
export function projectCodemodePreference(projectText: string | undefined): CodemodeChoice | undefined {
  if (projectText === undefined) return undefined;
  const automatic = startsWithCodemode(GLOBAL_SETTINGS_FOR.automatic, projectText);
  if (automatic !== startsWithCodemode(GLOBAL_SETTINGS_FOR.always, projectText)) return undefined;
  return automatic ? "always" : "automatic";
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "settings.json");
}

function readProjectSettingsText(settingsPath: string): string | undefined {
  try {
    return readRegularFileText(settingsPath, PROJECT_SETTINGS_MAX_BYTES);
  } catch {
    // Unreadable, or not a regular file: pi reads one it cannot read as empty too.
    return undefined;
  }
}

/**
 * Whether the project at `cwd` decides Code mode for its sessions through its
 * `.pi/settings.json`. Call it only for a project whose settings sessions read
 * (a trusted one): an untrusted project's file never reaches a session. The
 * file is read without pi's lock, as `readBuiltinExtensionSwitches()` reads
 * it, so a write caught halfway reads as unparsable and reports nothing until
 * the next load.
 */
export function readProjectCodemodeOverride(cwd: string): ProjectCodemodeOverride | undefined {
  const settingsPath = projectSettingsPath(cwd);
  const preference = projectCodemodePreference(readProjectSettingsText(settingsPath));
  return preference ? { settingsPath, preference } : undefined;
}

/** What a trusted project's `.pi/settings.json` makes of Code mode for its sessions, whatever the global choice. */
export interface ProjectCodemodeOverride {
  settingsPath: string;
  /** "always" when its sessions start with `codemode` active, "automatic" when they start without it. */
  preference: CodemodeChoice;
}

/** Both global `codemode` settings, in one read. */
export async function readCodemodeSettings(settingsPath = getGlobalSettingsPath()): Promise<{
  mode: CodemodeModeSetting;
  inlineBudget: CodemodeInlineBudgetSetting;
}> {
  const settings = parseSettingsSync(settingsPath);
  return {
    mode: codemodeModeSetting(codemodeValueOf(settings, "mode")),
    inlineBudget: inlineBudgetSetting(codemodeValueOf(settings, "inlineBudget")),
  };
}

/** The global `codemode.mode` and `codemode.inlineBudget` in one read (alias of `readCodemodeSettings`). */
export async function readCodemodePreference(settingsPath = getGlobalSettingsPath()): Promise<CodemodeChoice> {
  const settings = parseSettingsSync(settingsPath);
  const raw = settings.defaultTools;
  return Array.isArray(raw)
    ? resolveDefaultToolEntries(raw as string[]).includes(CODEMODE) ? "always" : "automatic"
    : "automatic";
}

function parseSettingsSync(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid settings.json: expected an object");
  return parsed;
}

// ---------------------------------------------------------------------------
// codemode.mode
// ---------------------------------------------------------------------------

/**
 * A raw `codemode.mode` as the codemode extension reads it: "only" when it is
 * exactly that, anything else "on".
 */
function codemodeModeSetting(raw: unknown): CodemodeModeSetting {
  if (raw === "only") return { value: "only" };
  if (raw === undefined || raw === "on") return { value: "on" };
  return { value: "on", invalid: invalidValueText(raw) };
}

/** What a trusted project's `.pi/settings.json` makes of the mode for its sessions, whatever the global value. */
export interface ProjectCodemodeMode extends CodemodeModeSetting {
  settingsPath: string;
}

/**
 * The mode a project's settings text gives its sessions when the global value
 * no longer matters there, undefined when the global value still decides.
 */
export function readProjectCodemodeMode(cwd: string): ProjectCodemodeMode | undefined {
  const settingsPath = projectSettingsPath(cwd);
  const text = readProjectSettingsText(settingsPath);
  if (text === undefined) return undefined;
  const mode = projectCodemodeValue("mode", ["on", "only"], text);
  return mode ? { settingsPath, ...codemodeModeSetting(mode.raw) } : undefined;
}

/**
 * The raw `codemode[key]` a project's settings text gives its sessions when
 * the global value no longer matters there, undefined when the global value
 * still decides. Merged by the SDK itself under two global values that differ
 * for the extension, the project decides when both give the same value.
 */
function projectCodemodeValue(
  key: CodemodeKey,
  globalValues: readonly [unknown, unknown],
  projectText: string,
): { raw: unknown } | undefined {
  const first = mergedCodemodeValue(key, globalValues[0], projectText);
  if (JSON.stringify(first) !== JSON.stringify(mergedCodemodeValue(key, globalValues[1], projectText))) return undefined;
  return { raw: first };
}

/** The merged `codemode[key]` a trusted project's session reads, with `globalValue` in the global settings. */
function mergedCodemodeValue(key: CodemodeKey, globalValue: unknown, projectText: string): unknown {
  const globalText = JSON.stringify({ codemode: { [key]: globalValue } });
  return codemodeValueOf({ codemode: mergedSettings(globalText, projectText).getSettings().codemode }, key);
}

// ---------------------------------------------------------------------------
// codemode.inlineBudget
// ---------------------------------------------------------------------------

/** pi's default budget, in estimated tokens (characters / 4), when the setting is unset or ignored. */
export const CODEMODE_INLINE_BUDGET_DEFAULT = DEFAULT_CODEMODE_INLINE_BUDGET;
/** The largest budget Settings saves. pi itself takes any finite number of 0 or more. */
export const CODEMODE_INLINE_BUDGET_MAX = 1_000_000;

/**
 * A raw `codemode.inlineBudget` as the codemode extension reads it: a finite
 * number of 0 or more is used, anything else leaves the default.
 */
function inlineBudgetSetting(raw: unknown): CodemodeInlineBudgetSetting {
  if (raw === undefined) return {};
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return { value: raw };
  return { invalid: invalidValueText(raw) };
}

/** What a trusted project's `.pi/settings.json` makes of the budget for its sessions, whatever the global value. */
export interface ProjectCodemodeInlineBudget extends CodemodeInlineBudgetSetting {
  settingsPath: string;
}

/**
 * The budget a project's settings text gives its sessions when the global
 * value no longer matters there, undefined when the global value still
 * decides.
 */
export function readProjectCodemodeInlineBudget(cwd: string): ProjectCodemodeInlineBudget | undefined {
  const settingsPath = projectSettingsPath(cwd);
  const text = readProjectSettingsText(settingsPath);
  if (text === undefined) return undefined;
  const budget = projectCodemodeValue("inlineBudget", [1, 2], text);
  return budget ? { settingsPath, ...inlineBudgetSetting(budget.raw) } : undefined;
}
