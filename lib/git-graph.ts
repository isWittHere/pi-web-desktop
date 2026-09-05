import path from "path";
import type { GitLogCommit } from "./git-graph-parser";
import { formatGitLogCommand, parseGitLog } from "./git-graph-parser";
import { findRepositoryRoot, git } from "./git-changes";

/**
 * Server-side data for the git graph tab: a bounded `git log` (no `--graph`
 * needed — the client's lane state machine derives geometry from parent
 * links) and per-commit changed-file lists for the detail card.
 */

export interface GitLogResponse {
  isGitRepository: boolean;
  commits: GitLogCommit[];
  truncated: boolean;
}

export interface GitCommitFile {
  /** Absolute path of the file (renames resolve to the new path). */
  filePath: string;
  /** git name-status letter: M / A / D / R / C / T / U. */
  code: string;
  originalPath?: string;
}

export interface GitCommitFilesResponse {
  supported: boolean;
  files: GitCommitFile[];
}

const GIT_GRAPH_MAX_BUFFER = 16 * 1024 * 1024;

export async function getGitLog(cwd: string, limit: number): Promise<GitLogResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { isGitRepository: false, commits: [], truncated: false };
  try {
    // One extra commit detects truncation without a separate count query.
    const output = await git(repositoryRoot, formatGitLogCommand(limit + 1), GIT_GRAPH_MAX_BUFFER);
    const commits = parseGitLog(output);
    return {
      isGitRepository: true,
      commits: commits.slice(0, limit),
      truncated: commits.length > limit,
    };
  } catch {
    // An unborn HEAD (repository without commits) or a git failure: show an
    // empty graph rather than an error.
    return { isGitRepository: true, commits: [], truncated: false };
  }
}

interface NameStatusRecord {
  code: string;
  repoPath: string;
  originalPath?: string;
}

/** Parse the -z (NUL-delimited) form of `git diff --name-status`. */
function parseNameStatus(output: string): NameStatusRecord[] {
  const fields = output.split("\0");
  const records: NameStatusRecord[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const status = fields[i];
    if (!status) continue;
    const letter = status[0];
    const isRenameLike = letter === "R" || letter === "C";
    const originalPath = isRenameLike ? fields[++i] : undefined;
    const repoPath = fields[++i];
    if (!repoPath) continue;
    records.push({ code: letter, repoPath, originalPath: originalPath || undefined });
  }
  return records;
}

function toAbsoluteFiles(repositoryRoot: string, records: NameStatusRecord[]): GitCommitFile[] {
  return records.map((record) => ({
    filePath: path.resolve(repositoryRoot, record.repoPath),
    code: record.code,
    ...(record.originalPath ? { originalPath: path.resolve(repositoryRoot, record.originalPath) } : {}),
  }));
}

export async function getGitCommitFiles(cwd: string, hash: string): Promise<GitCommitFilesResponse> {
  if (!/^[0-9a-f]{6,40}$/i.test(hash)) return { supported: false, files: [] };
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) return { supported: false, files: [] };

  try {
    const parentsOutput = await git(repositoryRoot, ["log", "-1", "--format=%P", hash]);
    const parents = parentsOutput.trim().split(" ").filter(Boolean);
    // Diffs are shown against the first parent (root commits against the
    // empty tree), matching how graph tools display merge commits.
    const output = parents.length === 0
      ? await git(repositoryRoot, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", "--find-renames", hash])
      : await git(repositoryRoot, ["diff", "--name-status", "-z", "--find-renames", parents[0], hash]);
    return { supported: true, files: toAbsoluteFiles(repositoryRoot, parseNameStatus(output)) };
  } catch {
    return { supported: false, files: [] };
  }
}
