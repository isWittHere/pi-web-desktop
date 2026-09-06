/**
 * Turns raw git ref decorations (%D entries) into display tags for the git
 * graph rows and the commit detail card.
 *
 * `%D` yields comma-separated decorations such as:
 *   "HEAD -> main"    HEAD points at a local branch
 *   "origin/feature"  remote-tracking branch
 *   "tag: v1.2"       annotated or lightweight tag
 *   "HEAD"            detached HEAD
 */

export type GitRefTagKind = "head" | "branch" | "remote" | "tag";

export interface GitRefTag {
  kind: GitRefTagKind;
  /** Text shown inside the rounded tag chip. */
  label: string;
  /** Original decoration, kept for tooltips. */
  ref: string;
}

const HEAD_PREFIX = "HEAD -> ";
const TAG_PREFIX = "tag:";

export function parseGitRefTags(refs: string[]): GitRefTag[] {
  const tags: GitRefTag[] = [];
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(HEAD_PREFIX)) {
      const branch = trimmed.slice(HEAD_PREFIX.length).trim();
      tags.push({ kind: "head", label: "HEAD", ref: "HEAD" });
      if (branch) tags.push({ kind: "branch", label: branch, ref: trimmed });
    } else if (trimmed === "HEAD") {
      tags.push({ kind: "head", label: "HEAD", ref: trimmed });
    } else if (trimmed.startsWith(TAG_PREFIX)) {
      const name = trimmed.slice(TAG_PREFIX.length).trim();
      // A nameless "tag:" decoration carries nothing displayable.
      if (name) tags.push({ kind: "tag", label: name, ref: trimmed });
    } else if (trimmed.includes("/")) {
      tags.push({ kind: "remote", label: trimmed, ref: trimmed });
    } else {
      tags.push({ kind: "branch", label: trimmed, ref: trimmed });
    }
  }
  return tags;
}
