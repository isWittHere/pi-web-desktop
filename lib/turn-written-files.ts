import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFilePath } from "./file-links";
import { isEditToolName, isWriteToolName } from "./tool-names";

export interface WrittenFile {
  /** Resolved absolute path of a file this turn wrote. */
  filePath: string;
  /** Added lines across this turn's edits to the file (when determinable). */
  additions?: number;
  /** Removed lines across this turn's edits to the file (when determinable). */
  deletions?: number;
}

function isFileWritingToolName(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName);
}

function readToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Count added and removed lines in a unified diff patch.
 *
 * Only `+`/`-` body lines count; file headers (`--- `, `+++ `), hunk headers
 * (`@@`), and artifacts such as `\ No newline at end of file` are ignored
 * because they never start with a single `+`/`-` prefix. The header check is
 * space-sensitive so an added line whose content itself starts with `++`
 * (rendered as `+++...` in the patch) is still counted.
 */
export function countPatchStats(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+")) {
      if (!line.startsWith("+++ ")) additions += 1;
    } else if (line.startsWith("-")) {
      if (!line.startsWith("--- ")) deletions += 1;
    }
  }
  return { additions, deletions };
}

/**
 * Diff stats for a successful `write` tool call: the whole file was (re)written,
 * so every line of the new content counts as an addition. Overwriting an
 * existing file therefore reports the new file's full size rather than a delta.
 */
function countWriteLines(input: Record<string, unknown> | undefined): number {
  const content = input?.content;
  if (typeof content !== "string" || content.length === 0) return 0;
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
}

/**
 * Diff stats from a successful `edit` tool call. Pi stores the exact unified
 * patch of the edit in `details.patch`, which is this turn's true change —
 * unlike a working-tree-vs-HEAD diff it never includes earlier turns' edits.
 */
function readEditResultStats(result: ToolResultMessage): { additions: number; deletions: number } {
  const details = result.details;
  if (typeof details !== "object" || details === null) return { additions: 0, deletions: 0 };
  const patch = (details as Record<string, unknown>).patch;
  if (typeof patch !== "string" || patch.length === 0) return { additions: 0, deletions: 0 };
  return countPatchStats(patch);
}

/**
 * Collect the distinct files a single assistant turn actually wrote, plus the
 * line additions/deletions this turn's writes caused.
 *
 * Every entry is derived from a `write`/`edit` tool call whose result arrived
 * and did not error — never from the reply text. A path the assistant merely
 * mentions in prose is not evidence that any file was touched, so it is not a
 * source here; the tool call is the record of what happened.
 *
 * Paths are resolved against `cwd`, deduped, and kept in first-seen order.
 * Stats accumulate across multiple edits to the same file; entries without a
 * determinable diff (e.g. old sessions without `details`) carry no counts.
 */
export function extractTurnWrittenFiles(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): WrittenFile[] {
  const byPath = new Map<string, { filePath: string; additions: number; deletions: number }>();

  for (const block of content) {
    if (block.type !== "toolCall") continue;
    if (!isFileWritingToolName(block.toolName)) continue;

    // No result yet (still streaming) or the call failed — nothing was written.
    const result = toolResults?.get(block.toolCallId);
    if (!result || result.isError) continue;

    const rawPath = readToolPath(block.input);
    if (!rawPath) continue;

    // Tool arguments are filesystem paths, not hrefs: preserve characters such
    // as #, ?, and :digits that have special meaning in links and source refs.
    const filePath = resolveLocalFilePath(rawPath, cwd);
    if (!filePath) continue;

    const stats = isEditToolName(block.toolName)
      ? readEditResultStats(result)
      : { additions: countWriteLines(block.input), deletions: 0 };

    const existing = byPath.get(filePath);
    if (existing) {
      existing.additions += stats.additions;
      existing.deletions += stats.deletions;
    } else {
      byPath.set(filePath, { filePath, ...stats });
    }
  }

  return [...byPath.values()].map(({ filePath, additions, deletions }) => {
    const file: WrittenFile = { filePath };
    if (additions > 0) file.additions = additions;
    if (deletions > 0) file.deletions = deletions;
    return file;
  });
}
