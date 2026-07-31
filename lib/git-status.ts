import type { GitFileStatus } from "./git-types";

export interface GitPorcelainEntry {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
}

function usesRenamePath(indexStatus: string, worktreeStatus: string): boolean {
  return indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C";
}

/** Parse `git status --porcelain=v1 -z` without relying on locale-specific text. */
export function parseGitPorcelainV1(output: string): GitPorcelainEntry[] {
  const records = output.split("\0");
  const entries: GitPorcelainEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4 || record[2] !== " ") continue;

    const entry: GitPorcelainEntry = {
      path: record.slice(3),
      indexStatus: record[0],
      worktreeStatus: record[1],
    };
    if (usesRenamePath(entry.indexStatus, entry.worktreeStatus)) {
      entry.originalPath = records[index + 1] || undefined;
      index += 1;
    }
    entries.push(entry);
  }

  return entries;
}

const CONFLICT_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function classifyGitStatus(entry: GitPorcelainEntry): Pick<GitFileStatus, "status" | "code"> {
  const pair = `${entry.indexStatus}${entry.worktreeStatus}`;
  if (pair === "??") return { status: "untracked", code: "U" };
  if (CONFLICT_STATUSES.has(pair) || pair.includes("U")) return { status: "conflict", code: "C" };
  if (pair.includes("D")) return { status: "deleted", code: "D" };
  if (pair.includes("R") || pair.includes("C")) return { status: "renamed", code: "R" };
  if (pair.includes("A")) return { status: "added", code: "A" };
  return { status: "modified", code: "M" };
}
