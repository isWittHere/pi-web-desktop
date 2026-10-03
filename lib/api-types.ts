import type { McpExposure, ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import type { SubagentProfile } from "./subagents";

// ---------------------------------------------------------------------------
// Settings › MCP (ADR 0006). Every refusal carries `{ error, reason }`: `error`
// is an English diagnostic, `reason` a code the panel translates.
// ---------------------------------------------------------------------------

export type McpScope = "global" | "project";

/** A value the SDK resolves before it connects: a stdio `env` value, an HTTP header, or `oauth.clientSecret`. */
export interface McpConfigFieldRef {
  kind: "env" | "header" | "oauth-client-secret";
  /** The variable or header name; absent for `oauth.clientSecret`. */
  name?: string;
}

/** How a connection test ended (`POST /api/mcp/test`). */
export type McpTestState = "connected" | "needs-auth" | "failed";

/** One tool a tested server listed. */
export interface McpTestTool {
  name: string;
  /** The first line of its description (or title), shortened. */
  description?: string;
  /** The server marks it read-only (`annotations.readOnlyHint`). */
  readOnly: boolean;
  /** How it reaches the model under the entry's `exposure` and `toolExposure`. */
  exposure: McpExposure;
}

/**
 * What a connection test found. Literal env and header values, `!command`
 * texts, what they resolved to, and the secret parts of the command, the
 * arguments and the URL are masked in `error`, `stderr`, the tools'
 * descriptions and `serverInfo`.
 */
export interface McpTestResult {
  state: McpTestState;
  /** Why it failed, as the SDK words it, without the stderr tail (`stderr`); at most 2,000 characters. */
  error?: string;
  /** The last 2,000 characters a stdio server wrote to stderr, when it did not connect. */
  stderr?: string;
  /** The server did not answer within the test's deadline, and Pi Web stopped the test. */
  timedOut?: boolean;
  /** Another test of a server that runs a shell command held the queue past the deadline, so this one never started. */
  queueTimedOut?: boolean;
  /** At most `MCP_TEST_MAX_TOOLS`, in the server's order; `toolCount` counts all of them. */
  tools: McpTestTool[];
  toolCount: number;
  /** Present when the server offers resources. */
  resources?: number;
  resourceTemplates?: number;
  serverInfo?: { name: string; version: string; title?: string };
  /** The folder a stdio server ran in. */
  cwd?: string;
  /** From connecting to the result, without any wait in the queue. */
  durationMs: number;
  /** How long it waited for other tests of servers that run a shell command, when it did. */
  queuedMs?: number;
  /** When it finished, in milliseconds since the epoch. */
  testedAt: number;
  /** The connection a Settings sign-in made right after it stored new tokens (`lib/mcp-sign-in.ts`), not a Test. */
  afterSignIn?: true;
}

/**
 * What an open session's MCP host last saw of a server (`lib/mcp-host.ts`):
 * - `connecting`: the session opened a connection that has not finished;
 * - `connected`: its tools are registered in the session;
 * - `needs-auth`: the server asked for an OAuth sign-in;
 * - `failed`: the connection ended before the server was ready;
 * - `disconnected`: a connection that was ready dropped (a stdio server
 *   exited); the session connects again at the next call to one of its tools;
 * - `conflict`: another extension of the session registered an MCP server of
 *   that name first, so the session does not connect this entry;
 * - `not-trusted`: the project's `.pi/mcp.json` declares it, and the session
 *   did not read the file because no decision trusted the project.
 */
export type McpSessionState =
  | "connecting"
  | "connected"
  | "needs-auth"
  | "failed"
  | "disconnected"
  | "conflict"
  | "not-trusted";

/**
 * A server's state as a session's MCP host recorded it. Sessions report what
 * they see as it happens, and the latest report wins, whichever session made
 * it: a global stdio server runs once per session, each in its own folder,
 * so `cwd` says which one this is. Masked like a test's messages.
 */
export interface McpSessionStatus {
  origin: "session";
  state: McpSessionState;
  sessionId: string;
  /** The session's folder: a stdio server runs relative to it, and it is the MCP root the server is sent. */
  cwd: string;
  /** When the session saw it, in milliseconds since the epoch. */
  updatedAt: number;
  /** `failed`: why, as far as the transport says; at most 2,000 characters. */
  error?: string;
  /** `failed` / `disconnected`, stdio: the last 2,000 characters the server wrote to stderr. */
  stderr?: string;
  /** `conflict`: the extension whose server of that name the session kept. */
  conflict?: string;
  /**
   * `connected`: when the session closed that connection itself (it went
   * idle, ended, or reloaded), so the record says what it saw, not that it
   * still holds one. A closed report reads like an untested entry's row.
   */
  closedAt?: number;
}

/** A server's last known connection state: the newest of a test (`origin: "test"`) and an open session's report. */
export type McpServerStatus = ({ origin: "test" } & McpTestResult) | McpSessionStatus;

/**
 * One `mcpServers` entry, described from the file without resolving anything
 * (full shape with the Settings panel; the status store keys it by scope,
 * source path, name and content). The status types it carries live above.
 */
export interface McpServerInfo {
  name: string;
  scope: McpScope;
  sourcePath: string;
  /** Identifies the entry's content: an HMAC of its canonical JSON (`mcpConfigKey()`). */
  configKey: string;
  enabled: boolean;
  validated: boolean;
  envNames: string[];
  headerNames: string[];
  usesOAuth: boolean;
  commandFields: McpConfigFieldRef[];
  masked: boolean;
  /** The last known connection state, from a test or an open session (`lib/mcp-status.ts`). */
  status?: McpServerStatus;
  [key: string]: unknown;
}

/**
 * An open session whose MCP host hands no server to the SDK, because the
 * session's `/mcp` command comes from another extension than Pi's built-in
 * MCP extension (which may then connect them its own way). Only a session can
 * tell: it takes loading the extensions.
 */
export interface McpHostInactiveInfo {
  /** The extension the `/mcp` command comes from. */
  owner: string;
  /** The session's folder. */
  cwd: string;
  updatedAt: number;
}

export interface SubagentProfilesResponse {
  profiles: SubagentProfile[];
}

export interface SubagentSettingsResponse {
  enabled: boolean;
  maxConcurrent: number;
}

export interface ShellToolSettingsResponse {
  isWindows: boolean;
  powerShellEnabled: boolean;
  /** How the codemode tool is activated: "always" = pinned in defaultTools. */
  codemode?: "automatic" | "always";
  /** Codemode sandbox self-test outcome for this server process. */
  sandboxAvailable?: boolean;
  sandboxError?: string;
  /** Trusted project settings.json that governs the choice (global writes are shadowed). */
  projectOverride?: string;
}

export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

export type SkillInstallScope = "global" | "project";

export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

export type SkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "unsupported"
  | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
}

export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: Array<{ type: "warning" | "error"; message: string; source?: string; path?: string }>;
  projectResourcesLoaded: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: {
    source?: string;
    scope?: string;
  };
  install?: SkillInstallInfo;
}

export type PluginScope = "global" | "project";
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface PluginDiagnostic {
  type: "warning" | "error";
  message: string;
  source?: string;
  path?: string;
}

export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

export type PluginUpdateState =
  | "update-available"
  | "up-to-date"
  | "unsupported"
  | "error";

export interface PluginUpdateResult {
  source: string;
  scope: PluginScope;
  displayName: string;
  type: "npm" | "git";
  state: PluginUpdateState;
  message?: string;
}

export interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  canCheckForUpdates: boolean;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

export interface PluginsResponse {
  packages: PluginPackageInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}
