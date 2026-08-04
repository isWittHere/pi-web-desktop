/**
 * Tool tone classification — categorises tool calls into semantic tones
 * so the UI can render appropriate icons, labels, and targeted file badges.
 *
 * Inspired by the my-last-feedback agent panel's toolStepTone() logic.
 */

export type StepTone =
  | "document_change"
  | "document_read"
  | "document_search"
  | "directory_list"
  | "file_find"
  | "command_execution"
  | "todo_update"
  | "artifact_output"
  | "approval_rejected";

export type DocumentChangeKind = "create" | "edit" | "delete";

export interface ToolIdentity {
  toolName: string;
  label?: string;
  title?: string;
  args?: Record<string, unknown>;
  result?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function identityText(tool: ToolIdentity): string {
  return [tool.toolName, tool.title, tool.label].filter(Boolean).join("\n").toLowerCase();
}

function hasArgKey(args: Record<string, unknown> | undefined, names: string[]): boolean {
  if (!args) return false;
  const lower = new Set(names.map((n) => n.toLowerCase()));
  return Object.keys(args).some((key) => lower.has(key.toLowerCase()));
}

function firstStringArg(
  args: Record<string, unknown> | undefined,
  names: string[],
): string | undefined {
  if (!args) return undefined;
  const lower = new Set(names.map((n) => n.toLowerCase()));
  for (const [key, value] of Object.entries(args)) {
    if (!lower.has(key.toLowerCase()) || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Tone detection
// ---------------------------------------------------------------------------

/** Classify a tool call into one of the semantic step tones. */
export function classifyToolTone(tool: ToolIdentity): StepTone | undefined {
  const text = identityText(tool);
  const hasPath = hasArgKey(tool.args, ["path", "file", "filePath", "filepath"]);
  const hasWritePayload = hasArgKey(tool.args, [
    "content", "oldString", "old_string", "newString", "new_string",
    "patch", "diff", "edits", "text",
  ]);
  const hasCommandPayload = hasArgKey(tool.args, ["command", "cmd", "script"]);
  const hasPattern = hasArgKey(tool.args, ["pattern", "query"]);

  // Command execution — must be checked FIRST so bash/shell commands aren't
  // misclassified by the regex patterns below (e.g. "bash cat" matching "cat"
  // in document_read, "bash ls" matching "ls" in directory_list, etc.)
  if (
    hasCommandPayload ||
    /\b(bash|shell|terminal|command|run|exec|execute|python|node|npm|pnpm|yarn|cargo|go|pytest|test|build|make|git|docker|kubectl|curl|wget)\b/i.test(text)
  ) {
    return "command_execution";
  }

  // Todo / task list
  if (/\b(todo|todowrite|todo_write|write_todo|task_list|task\s*list)\b/i.test(text)) {
    return "todo_update";
  }

  // Document change — edit/write/create/delete
  if (
    /\b(edit|write|patch|apply|modify|replace|update|create|delete|remove|insert|rename|move)\b/i.test(text) ||
    (hasPath && hasWritePayload)
  ) {
    return "document_change";
  }

  // Directory listing — ls / list / dir
  if (
    isListToolName(tool.toolName) ||
    /\b(ls|list\s*directory|list\s*dir|dir\s*list|listdir)\b/i.test(text)
  ) {
    return "directory_list";
  }

  // File find — find / glob / file_search (name-based, not content)
  if (
    isFindToolName(tool.toolName) ||
    /\b(find[_\s]*files?|file[_\s]*find|glob|scan[_\s]*files?)\b/i.test(text)
  ) {
    return "file_find";
  }

  // Content search — grep / rg / search / semantic_search
  if (
    /\b(grep|rg|search|semantic|fuzzy|ripgrep)\b/i.test(text) ||
    isSearchToolName(tool.toolName) ||
    (hasPattern && !hasWritePayload && !hasCommandPayload)
  ) {
    return "document_search";
  }

  // Read
  if (
    /\b(read|view|open|cat|show|display)\b/i.test(text) ||
    (hasPath && !hasWritePayload && !hasCommandPayload)
  ) {
    return "document_read";
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Document change kind — create / edit / delete
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try { return asRecord(JSON.parse(value)); }
  catch { return {}; }
}

function normalizeChangeType(value: unknown): DocumentChangeKind | undefined {
  if (value === "add" || value === "added" || value === "create") return "create";
  if (value === "delete" || value === "deleted" || value === "remove" || value === "removed") return "delete";
  if (value === "update" || value === "modified" || value === "edit" || value === "move") return "edit";
  return undefined;
}

function summarizeKinds(kinds: DocumentChangeKind[]): DocumentChangeKind | undefined {
  if (kinds.length === 0) return undefined;
  return new Set(kinds).size === 1 ? kinds[0] : "edit";
}

function changeKindFromFiles(value: unknown): DocumentChangeKind | undefined {
  if (!Array.isArray(value)) return undefined;
  return summarizeKinds(
    value
      .map((item) => normalizeChangeType(asRecord(item).type || asRecord(item).status || asRecord(item).changeType))
      .filter((k): k is DocumentChangeKind => Boolean(k)),
  );
}

function changeKindFromPatchText(patchText: string): DocumentChangeKind | undefined {
  if (!patchText) return undefined;
  const addCount = (patchText.match(/^\*\*\* Add File:/gm) || []).length;
  const deleteCount = (patchText.match(/^\*\*\* Delete File:/gm) || []).length;
  const updateCount = (patchText.match(/^\*\*\* (Update File|Move to):/gm) || []).length;
  if (addCount || deleteCount || updateCount) {
    const kinds: DocumentChangeKind[] = [];
    if (addCount) for (let i = 0; i < addCount; i++) kinds.push("create");
    if (deleteCount) for (let i = 0; i < deleteCount; i++) kinds.push("delete");
    if (updateCount) for (let i = 0; i < updateCount; i++) kinds.push("edit");
    return summarizeKinds(kinds);
  }
  if (/^@@ -0,0 \+\d+/m.test(patchText)) return "create";
  if (/^@@ -\d+(?:,\d+)? \+0,0/m.test(patchText)) return "delete";
  return undefined;
}

function changeKindFromResultSummary(result: string | undefined): DocumentChangeKind | undefined {
  if (!result) return undefined;
  const lines = result.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[ADM]\s+/.test(l));
  if (lines.length === 0) return undefined;
  return summarizeKinds(
    lines.map((l) => (l.startsWith("A ") ? "create" : l.startsWith("D ") ? "delete" : "edit")),
  );
}

function changeKindFromCommand(command: string | undefined): DocumentChangeKind | undefined {
  if (!command) return undefined;
  const cmd = command.trim().replace(/\s+/g, " ").toLowerCase();
  if (/^(?:rm|del|erase|unlink)\b/.test(cmd)) return "delete";
  if (/^remove-item\b/.test(cmd)) return "delete";
  if (/^mkdir\b/.test(cmd)) return "create";
  return undefined;
}

/** Determine whether a document_change tool is creating, editing, or deleting. */
export function classifyDocumentChangeKind(tool: ToolIdentity): DocumentChangeKind {
  const metadata = tool.metadata || {};
  const fileDiff = asRecord(metadata.filediff);
  const resultRecord = parseJsonRecord(tool.result);

  return (
    changeKindFromFiles(metadata.files) ??
    changeKindFromFiles(resultRecord.files) ??
    normalizeChangeType(metadata.type || metadata.status || metadata.changeType) ??
    (metadata.exists === false ? "create" : undefined) ??
    (metadata.exists === true ? "edit" : undefined) ??
    changeKindFromPatchText(
      typeof metadata.diff === "string" ? metadata.diff : "",
    ) ??
    changeKindFromPatchText(
      typeof metadata.patch === "string" ? metadata.patch : "",
    ) ??
    changeKindFromPatchText(
      typeof fileDiff.patch === "string" ? fileDiff.patch : "",
    ) ??
    changeKindFromPatchText(
      typeof tool.args?.patchText === "string" ? tool.args.patchText : "",
    ) ??
    changeKindFromResultSummary(tool.result) ??
    changeKindFromCommand(typeof tool.args?.command === "string" ? tool.args.command : undefined) ??
    "edit"
  );
}

// ---------------------------------------------------------------------------
// Tool name classification
// ---------------------------------------------------------------------------

export function isListToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "ls" || lower === "list" || lower === "dir" ||
    lower.startsWith("list_") || lower.endsWith("_list") ||
    lower.includes("list_directory") || lower.includes("list_dir");
}

export function isFindToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "find" || lower === "glob" || lower === "scan" ||
    lower.includes("file_search") || lower.includes("file_find") ||
    lower.startsWith("find_") || lower.startsWith("glob_") ||
    lower.startsWith("scan_");
}

export function isSearchToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("grep") || lower.includes("search") ||
    lower.includes("fuzzy") || lower.includes("ripgrep");
}

export function isReadToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("read") || lower.startsWith("get_") ||
    lower.includes("_read") || lower.includes("_get");
}

export function isEditToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "edit" || lower.startsWith("edit_") || lower.includes("str_replace") ||
    lower.includes("replace_editor") || lower.includes("_edit") ||
    lower.startsWith("write") || lower.includes("_write");
}

// ---------------------------------------------------------------------------
// Target extraction
// ---------------------------------------------------------------------------

/**
 * Extract the primary file target from a tool call for display purposes.
 * Searches args first, then metadata, then result.
 */
export function extractToolTarget(tool: ToolIdentity): string | undefined {
  const argTarget = firstStringArg(tool.args, [
    "path", "file", "filePath", "filepath",
  ]);
  if (argTarget) return argTarget;

  const metaTarget = firstStringArg(tool.metadata, [
    "relativePath", "filePath", "filepath", "path", "file",
  ]);
  if (metaTarget) return metaTarget;

  const firstMetaFile = Array.isArray(tool.metadata?.files)
    ? asRecord(tool.metadata.files[0])
    : {};
  const metaFileTarget = firstStringArg(firstMetaFile, [
    "relativePath", "filePath", "filepath", "path", "file",
  ]);
  if (metaFileTarget) return metaFileTarget;

  return undefined;
}

/** Extract the last path segment (file/dir name) from a path string. */
export function basenameResourcePath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

// ---------------------------------------------------------------------------
// Shell command subclassification
// ---------------------------------------------------------------------------

export type ShellCommandKind = "list" | "search" | "find" | "read" | "fetch" | "delete" | "copy" | "run";

export interface ShellCommandInfo {
  kind: ShellCommandKind;
  binary: string;
  argument?: string;
}

/** Commands that are just navigation / env setup — skip them to find the real command. */
const SKIP_COMMANDS = new Set([
  "cd", "chdir", "pwd", "echo", "set", "export", "source", ".",
  "pushd", "popd", "dirs",
]);

/**
 * Commands that wrap another command — skip them (and their flags/values) to
 * find the real work command.
 */
const WRAPPER_SKIP_COMMANDS = new Set([
  "timeout", "sudo", "doas", "nohup", "nice", "env", "command", "exec",
  "eval", "bash", "sh", "zsh", "ash", "dash", "fish", "ksh",
]);

/** Wrappers whose command string (`bash -c '...'`, `eval '...'`) is itself parsed. */
const COMMAND_STRING_WRAPPERS = new Set([
  "bash", "sh", "zsh", "ash", "dash", "fish", "ksh", "eval",
]);

const LIST_COMMANDS = new Set(["ls", "dir", "ll", "la", "l", "tree", "eza", "exa"]);
const SEARCH_COMMANDS = new Set(["rg", "grep", "egrep", "fgrep", "ack", "ag", "ripgrep"]);
const FIND_COMMANDS = new Set(["find", "fd", "fdfind", "locate", "mlocate", "glob"]);
const READ_COMMANDS = new Set(["cat", "head", "tail", "less", "more", "bat", "nl", "wc"]);
const FETCH_COMMANDS = new Set(["curl", "wget", "fetch", "http", "xh", "httpx"]);
const DELETE_COMMANDS = new Set(["rm", "del", "rmdir", "unlink", "erase"]);
const COPY_COMMANDS = new Set(["cp", "mv", "copy", "move", "rename", "ren"]);

function shellWords(command: string): string[] {
  return command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((w) => w.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
}

const EMPTY_FLAG_SET: ReadonlySet<string> = new Set();

/**
 * Options that consume the NEXT token as their value, per command family.
 * Only genuinely value-taking flags belong here — boolean switches (`-r` for
 * rm, `--verbose`, `-O` for curl…) must stay out or real targets get eaten.
 */
const VALUE_FLAGS_BY_COMMAND: Record<string, ReadonlySet<string>> = {
  curl: new Set([
    "-a", "-A", "-b", "-c", "-d", "-e", "-E", "-F", "-H", "-K", "-m", "-o",
    "-r", "-T", "-u", "-x", "-X",
    "--append", "--user-agent", "--cookie", "--cookie-jar", "--data",
    "--data-ascii", "--data-binary", "--data-raw", "--data-urlencode",
    "--form", "--form-string", "--header", "--config", "--max-time",
    "--connect-timeout", "--output", "--range", "--upload-file", "--user",
    "--proxy", "--request", "--retry", "--retry-delay", "--retry-connrefused",
    "--retry-all-errors", "--url", "--write-out", "--referer", "--resolve",
    "--interface", "--cert", "--key", "--cacert", "--capath", "--engine",
    "--pass", "--cipher", "--host", "--local-port", "--max-filesize",
    "--max-redirs", "--speed-limit", "--speed-time", "--proxy-user",
    "--proxy-header", "--oauth2-bearer", "--netrc-file", "--tls-max",
  ]),
  wget: new Set([
    "-O", "-o", "-P", "-T", "-w", "-Q", "-e", "-t",
    "--output-document", "--output-file", "--directory-prefix", "--timeout",
    "--connect-timeout", "--read-timeout", "--wait", "--quota", "--execute",
    "--tries", "--header", "--user-agent", "--user", "--password", "--referer",
    "--post-data", "--max-redirect", "--limit-rate", "--bind-address",
    "--load-cookies", "--save-cookies", "--auth-no-challenge",
  ]),
  git: new Set([
    "-b", "-C", "-L", "-G", "-S", "-m", "-n", "-o", "-u",
    "--branch", "--message", "--output", "--set-upstream", "--author",
    "--date", "--strategy", "--strategy-option", "--pathspec-from-file",
    "--since", "--until", "--grep", "--format", "--pretty", "--max-count",
    "--diff-filter", "--name-only", "--name-status",
  ]),
  npm: new Set([
    "-w", "--workspace", "--registry", "--tag", "--prefix", "--cache",
    "--userconfig", "--globalconfig", "--scope", "--install-strategy",
  ]),
  pnpm: new Set([
    "-F", "-C", "--filter", "--registry", "--prefix", "--dir", "--workspace",
    "--package-import-method", "--reporter",
  ]),
  yarn: new Set([
    "--registry", "--cwd", "--cached", "--focus", "--node-options",
    "--network-timeout", "--network-concurrency", "--install-mode",
  ]),
  pip: new Set([
    "-r", "-c", "-e", "-t", "-i", "--requirement", "--constraint", "--editable",
    "--target", "--index-url", "--extra-index-url", "--find-links",
    "--trusted-host", "--proxy",
  ]),
  cargo: new Set([
    "-p", "--package", "--target", "--manifest-path", "--features", "--bin",
    "--example", "--jobs", "--message-format", "--profile",
  ]),
  docker: new Set([
    "-c", "-e", "-f", "-p", "-u", "-v", "-w",
    "--publish", "--volume", "--env", "--env-file", "--name", "--network",
    "--cpus", "--memory", "--workdir", "--user", "--label", "--mount",
    "--add-host", "--dns", "--platform", "--entrypoint", "--restart",
    "--health-cmd", "--health-interval", "--log-driver", "--log-opt",
    "--stop-timeout", "--shm-size", "--ip", "--ip6", "--link", "--tmpfs",
    "--security-opt", "--device", "--runtime", "--file", "--config",
    "--build-arg", "--target",
  ]),
  npx: new Set([
    "-p", "-c", "-n", "--package", "--registry", "--call", "--node-arg", "--prefix",
  ]),
  python: new Set(["-c", "-W", "-X", "-I"]),
  node: new Set([
    "-e", "-r", "--eval", "--require", "--loader", "--experimental-loader",
    "--max-old-space-size", "--env-file", "--watch-path", "--conditions",
  ]),
  java: new Set([
    "-jar", "-cp", "-classpath", "-Xmx", "-Xms", "-Xss", "-agentlib",
    "-javaagent", "-module-path", "--add-modules", "--module-path",
  ]),
  ssh: new Set([
    "-b", "-c", "-D", "-E", "-F", "-i", "-J", "-l", "-L", "-m", "-o",
    "-p", "-R", "-w",
    "--port", "--identity-file", "--proxy-jump", "--config", "--log-file",
  ]),
  scp: new Set(["-P", "-i", "-o", "-l", "-F", "-c"]),
  rsync: new Set([
    "-b", "-e", "-f", "-T",
    "--rsh", "--filter", "--exclude", "--include", "--backup-dir", "--log-file",
    "--password-file", "--bwlimit", "--timeout", "--temp-dir", "--link-dest",
    "--compare-dest", "--copy-dest", "--files-from", "--suffix",
  ]),
  find: new Set([
    "-maxdepth", "-mindepth", "-name", "-iname", "-type", "-path", "-ipath",
    "-size", "-mtime", "-mmin", "-atime", "-amin", "-ctime", "-cmin",
    "-newer", "-anewer", "-cnewer", "-user", "-group", "-perm", "-regex",
    "-iregex", "-printf", "-fprintf", "-fls", "-fprint", "-fprint0",
  ]),
  rg: new Set([
    "-A", "-B", "-C", "-e", "-f", "-g", "-m", "-t",
    "--regexp", "--file", "--glob", "--after-context", "--before-context",
    "--context", "--max-count", "--type", "--type-add", "--sort", "--threads", "--pre",
  ]),
  grep: new Set([
    "-A", "-B", "-C", "-e", "-f", "-m",
    "--regexp", "--file", "--after-context", "--before-context", "--context",
    "--max-count", "--include", "--exclude", "--include-dir", "--exclude-dir",
    "--exclude-from",
  ]),
  tail: new Set(["-n", "-c", "-s", "--lines", "--bytes", "--sleep-interval"]),
  head: new Set(["-n", "-c", "--lines", "--bytes"]),
  sed: new Set(["-e", "-f", "-i"]),
  jq: new Set(["-f", "--arg", "--argjson", "--slurpfile"]),
  awk: new Set(["-F", "-v"]),
  make: new Set([
    "-C", "-f", "-I", "-j", "-l", "-o", "-W",
    "--file", "--directory", "--jobs", "--include-dir", "--old-file",
    "--what-if", "--load-average", "--eval",
  ]),
  go: new Set([
    "-o", "-run", "-count", "-tags", "-gcflags", "-ldflags", "-mod", "-pkgdir",
  ]),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
  xargs: new Set(["-I", "-n", "-d", "-P", "-L"]),
  apt: new Set(["-o", "-c", "-t", "--option", "--config-file", "--target-release"]),
  apt_get: new Set(["-o", "-c", "-t", "--option", "--config-file", "--target-release"]),
  sudo: new Set(["-u", "-g", "--user", "--group"]),
  doas: new Set(["-u", "-C"]),
  nice: new Set(["-n", "--adjustment"]),
  env: new Set(["-u", "-C", "--unset", "--chdir"]),
  deno: new Set([
    "--config", "--import-map", "--lock", "--v8-flags", "-L", "--log-level",
  ]),
  bash: new Set(["-c", "--command"]),
  sh: new Set(["-c", "--command"]),
  zsh: new Set(["-c", "--command"]),
  ash: new Set(["-c"]),
  dash: new Set(["-c"]),
  fish: new Set(["-c", "--command"]),
  ksh: new Set(["-c"]),
};

/**
 * Long options known to consume the next token as a value, applied to any
 * command as a fallback when no per-command table entry exists.
 */
const GENERIC_VALUE_LONG_OPTIONS = new Set([
  "--timeout", "--max-time", "--connect-timeout", "--read-timeout",
  "--retry", "--retries", "--retry-delay", "--tries", "--wait",
  "--output", "--output-file", "--output-document", "--directory",
  "--directory-prefix", "--target", "--file", "--path", "--config",
  "--input", "--header", "--user", "--password", "--token", "--key",
  "--cert", "--url", "--name", "--tag", "--prefix", "--registry",
  "--platform", "--arch", "--proxy", "--manifest-path", "--features",
  "--bin", "--example", "--package", "--max-count", "--glob",
  "--exclude", "--include", "--type", "--context", "--max-depth",
  "--min-depth", "--branch", "--message", "--author", "--date",
  "--grep", "--format", "--pretty", "--port", "--publish", "--volume",
  "--env", "--env-file", "--network", "--cpus", "--memory", "--workdir",
  "--label", "--mount", "--restart", "--requirement", "--index-url",
  "--find-links", "--trusted-host", "--eval", "--module", "--command",
  "--require", "--loader", "--signal", "--kill-after",
  "--max-old-space-size", "--jobs", "--profile", "--limit-rate",
  "--user-agent", "--referer", "--post-data", "--data", "--cookie",
  "--cookie-jar", "--resolve", "--interface", "--range", "--strategy",
  "--strategy-option", "--since", "--until", "--request", "--count",
]);

function isFlagWord(word: string): boolean {
  return word.length > 1 && word.startsWith("-");
}

/**
 * Whether a flag consumes the FOLLOWING token as its value.
 *
 * - `--opt=value` and attached short values (`-m60`, `-d@file`) are
 *   self-contained and never consume the next token.
 * - Short clusters (`-sLm`) take the value of their LAST option char (`-m`).
 * - `--` (end of options) never consumes.
 */
function flagConsumesNextToken(flag: string, valueFlags: ReadonlySet<string>): boolean {
  if (flag === "--" || flag.includes("=")) return false;
  if (flag.startsWith("--")) {
    return valueFlags.has(flag) || GENERIC_VALUE_LONG_OPTIONS.has(flag);
  }
  // Attached short value: -m60, -sLm60, -d@file — the value is inline.
  if (/^-[a-zA-Z]+[^a-zA-Z-]/.test(flag)) return false;
  if (valueFlags.has(flag)) return true;
  // Short cluster: the last option char may take a separate value (-sLm → -m).
  if (flag.length > 2 && /^-[a-zA-Z]+$/.test(flag)) {
    return valueFlags.has(`-${flag.slice(-1)}`);
  }
  return false;
}

/**
 * Classify the first meaningful command in a shell command string.
 * Skips `cd`, `export`, `echo` etc. to find the real work command, and skips
 * option VALUES (`--max-time 60`) so they are never mistaken for the target
 * argument. `bash -c '…'` / `eval '…'` wrappers are unwrapped and re-parsed.
 */
export function classifyShellCommand(raw: string, depth = 0): ShellCommandInfo {
  const segments = raw.split(/&&|\n|;(?!;)|(?<!\|)\|(?!\|)/);
  const firstWord = raw.split(/\s+/)[0]?.replace(/^[.\\/]+/, "") || "sh";
  const defaultResult: ShellCommandInfo = {
    kind: "run",
    binary: firstWord,
  };

  for (const segment of segments) {
    const words = shellWords(segment.trim());
    if (words.length === 0) continue;

    let i = 0;
    while (i < words.length) {
      const skipBin = words[i].toLowerCase();
      if (SKIP_COMMANDS.has(skipBin)) {
        i += 1;
        if (["cd", "chdir", "pushd"].includes(skipBin) && i < words.length) i += 1;
        continue;
      }
      if (WRAPPER_SKIP_COMMANDS.has(skipBin)) {
        const wrapperFlags = VALUE_FLAGS_BY_COMMAND[skipBin] ?? EMPTY_FLAG_SET;
        let innerCommand: string | undefined;
        i += 1;
        while (i < words.length && isFlagWord(words[i])) {
          const flag = words[i];
          const consumesNext = flagConsumesNextToken(flag, wrapperFlags);
          i += 1;
          if (consumesNext && i < words.length) {
            if (COMMAND_STRING_WRAPPERS.has(skipBin) && (flag === "-c" || flag === "--command")) {
              innerCommand = words[i];
            }
            i += 1;
          }
        }
        // `timeout [flags] DURATION CMD` — the duration is a positional argument.
        if (skipBin === "timeout" && i < words.length && /^\d/.test(words[i])) i += 1;
        // `eval 'command…'` — the next word is the command string.
        if (skipBin === "eval" && i < words.length) innerCommand = words[i];
        // `env FOO=bar cmd` — skip VAR=value assignments before the real command.
        while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
        if (innerCommand !== undefined && depth < 4) {
          return classifyShellCommand(innerCommand, depth + 1);
        }
        continue;
      }
      break;
    }

    if (i >= words.length) continue;

    const binary = words[i].replace(/^[.\\/]+/, "").toLowerCase();
    const binaryBase = binary.split(/[/\\]/).pop() || binary;
    const valueFlags = VALUE_FLAGS_BY_COMMAND[binaryBase] ?? EMPTY_FLAG_SET;

    // Find the first non-flag argument, skipping the VALUES of known
    // value-taking options (e.g. `curl --max-time 60 URL` → the URL, not `60`).
    let argIndex = i + 1;
    while (argIndex < words.length && isFlagWord(words[argIndex])) {
      if (words[argIndex] === "--") {
        argIndex += 1;
        break;
      }
      const consumesNext = flagConsumesNextToken(words[argIndex], valueFlags);
      argIndex += 1;
      if (consumesNext && argIndex < words.length) argIndex += 1;
    }
    const argument = argIndex < words.length ? words[argIndex] : undefined;

    if (LIST_COMMANDS.has(binaryBase)) return { kind: "list", binary: binaryBase, argument };
    if (SEARCH_COMMANDS.has(binaryBase)) return { kind: "search", binary: binaryBase, argument };
    if (FIND_COMMANDS.has(binaryBase)) return { kind: "find", binary: binaryBase, argument };
    if (READ_COMMANDS.has(binaryBase)) return { kind: "read", binary: binaryBase, argument };
    if (FETCH_COMMANDS.has(binaryBase)) return { kind: "fetch", binary: binaryBase, argument };
    if (DELETE_COMMANDS.has(binaryBase)) return { kind: "delete", binary: binaryBase, argument };
    if (COPY_COMMANDS.has(binaryBase)) return { kind: "copy", binary: binaryBase, argument };
    return { kind: "run", binary: binaryBase, argument };
  }

  return defaultResult;
}
