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

/** Commands that wrap another command — skip them and their arguments/flags. */
const WRAPPER_SKIP_COMMANDS = new Set([
  "timeout",
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

/**
 * Classify the first meaningful command in a shell command string.
 * Skips `cd`, `export`, `echo` etc. to find the real work command.
 */
export function classifyShellCommand(raw: string): ShellCommandInfo {
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
    while (
      i < words.length &&
      (SKIP_COMMANDS.has(words[i].toLowerCase()) || WRAPPER_SKIP_COMMANDS.has(words[i].toLowerCase()))
    ) {
      const skipBin = words[i].toLowerCase();
      i += 1;
      if (i < words.length && ["cd", "chdir", "pushd"].includes(skipBin)) i += 1;
      // timeout: skip --flags and the numeric duration argument to reach the real command
      if (skipBin === "timeout") {
        while (i < words.length && (words[i].startsWith("-") || /^\d/.test(words[i]))) {
          i++;
        }
      }
    }

    if (i >= words.length) continue;

    const binary = words[i].replace(/^[.\\/]+/, "").toLowerCase();
    const binaryBase = binary.split(/[/\\]/).pop() || binary;

    // Find first non-flag argument
    let argIndex = i + 1;
    while (argIndex < words.length && words[argIndex].startsWith("-")) {
      argIndex += 1;
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
