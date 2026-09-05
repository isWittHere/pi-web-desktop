/**
 * Parser for the git graph tab's log data.
 *
 * The server runs `git log` with a unit-separator (%x1f) format so commit
 * metadata survives any subject content (the prototype's `|` delimiter broke
 * on subjects containing pipes). Like the prototype, the ASCII graph rows of
 * `git log --graph` are NOT used for geometry — the lane state machine
 * (git-graph-lanes.ts) derives the layout from the parent links alone, so the
 * endpoint does not even need `--graph`.
 */

export interface GitLogCommit {
  hash: string;
  parents: string[];
  author: string;
  /** Unix timestamp in seconds. */
  timestamp: number;
  subject: string;
  /** Ref decorations, e.g. ["HEAD -> main", "origin/main"]. */
  refs: string[];
}

const FIELD_SEPARATOR = "\x1f";

export function formatGitLogCommand(limit: number): string[] {
  return [
    "log",
    `--max-count=${limit}`,
    "--topo-order",
    `--format=%H${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%at${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%D`,
  ];
}

export function parseGitLog(raw: string): GitLogCommit[] {
  const commits: GitLogCommit[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const fields = line.split(FIELD_SEPARATOR);
    // Six fields are expected; a subject may itself never contain \x1f, but
    // tolerate trailing empty refs safely.
    if (fields.length < 6) continue;
    const [hash, parents, author, timestamp, subject, refs] = fields;
    if (!hash) continue;
    commits.push({
      hash,
      parents: parents.split(" ").filter(Boolean),
      author,
      timestamp: Number(timestamp) || 0,
      subject,
      refs: refs ? refs.split(", ").filter(Boolean) : [],
    });
  }
  return commits;
}
