// @comment: git-commit mentions. Pure logic for routing the composer's @
// autocomplete to commit results, filtering commits, and building the insert
// text shared by the menu and the git-graph tab's mention button.
//
// Token shape: "@comment:<sha>[ (subject)]" — the @comment: prefix makes the
// reference self-describing for the model (it can resolve the sha with git
// tools), and the tokenizer classifies it independently of @file tokens so it
// never masquerades as a path. Completion inserts the subject in parentheses
// after the token (a space ends the token, so the subject renders as plain
// text following the styled mention).

import type { FileIndexEntry } from "./file-fuzzy";

/** Trigger prefix inside an @ token (after the @). */
export const COMMENT_AT_PREFIX = "comment:";

/** How many recent commits the menu works with — the fetch size in
 *  ChatInput and the result cap here stay in lockstep so nothing fetched is
 *  hidden by an unrelated file-result limit. */
export const COMMENT_FETCH_LIMIT = 50;

/** Full token inserted when the user picks the prefix suggestion; it ends
 *  without a space so the @ token stays open and the menu lists commits. */
const COMMENT_PREFIX_INSERTION = `@${COMMENT_AT_PREFIX}`;

/** The token carries a bare sha, so validity is a pure format check — no git
 *  data needed, which keeps highlight working in rendered history messages
 *  where no commit cache exists. Same bounds as lib/git-graph.ts (6-40) but
 *  starting at 7 so a bare word like "cafe" never styles as a commit. */
const COMMENT_SHA_RE = /^[0-9a-f]{7,40}$/i;

/** Structural subset of GitLogCommit — keeps this module dependency-free.
 *  refs rides along when the caller has it (menu rows show branch/tag chips). */
export interface CommentCommitRef {
  hash: string;
  subject: string;
  refs?: string[];
}

export type AtMenuItem =
  | { kind: "prefix" }
  | { kind: "commit"; commit: CommentCommitRef }
  | { kind: "file"; entry: FileIndexEntry };

/** True when the value after @comment: looks like a usable git sha. */
export function isCommentShaValue(value: string): boolean {
  return COMMENT_SHA_RE.test(value);
}

/**
 * Route an @ query to commit mode. Returns the filter text after the prefix,
 * or null when the query is not a comment: query. The full-width colon is
 * accepted (and normalized) because IME users naturally type "comment："
 * without switching layouts.
 */
export function parseCommentQuery(query: string | null): string | null {
  if (!query) return null;
  if (!query.startsWith("comment:") && !query.startsWith("comment：")) return null;
  // "comment：" and "comment:" share the same UTF-16 length.
  return query.slice(COMMENT_AT_PREFIX.length);
}

/**
 * Whether the prefix suggestion row should appear for the current (unrouted)
 * query: on empty @ and while typing any prefix of "comment".
 */
export function isCommentPrefixQuery(query: string | null): boolean {
  if (query === null) return false;
  if (parseCommentQuery(query) !== null) return false; // already routed
  if (query === "") return true;
  return COMMENT_AT_PREFIX.startsWith(query.toLowerCase());
}

/**
 * Filter commits by case-insensitive substring against hash + subject. An
 * empty filter yields the most recent commits (input order preserved).
 */
export function filterCommentCommits(
  commits: CommentCommitRef[],
  filter: string,
  limit: number,
): CommentCommitRef[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return commits.slice(0, limit);
  const scored = commits.filter((commit) =>
    commit.hash.toLowerCase().includes(needle)
    || commit.subject.toLowerCase().includes(needle));
  return scored.slice(0, limit);
}

/** Short display/insert sha — matches the git-graph UI's slice(0, 10). */
export function commentShortSha(hash: string): string {
  return hash.slice(0, 10);
}

/**
 * Full insert text for a completed commit mention. Starts at the @ (the
 * completion replaces the whole @token) and ends with a space so the token
 * closes and the menu hides; the subject rides along in parentheses as plain
 * text so the model immediately knows which change is referenced.
 */
export function buildCommentMentionText(commit: CommentCommitRef): { text: string; cursorOffset: number } {
  const subject = commit.subject.trim() || commentShortSha(commit.hash);
  const text = `@${COMMENT_AT_PREFIX}${commentShortSha(commit.hash)} (${subject}) `;
  return { text, cursorOffset: text.length };
}

/** Insertion record for the prefix suggestion (same shape as AtInsertion). */
export function buildCommentPrefixInsertion(): { text: string; cursorOffset: number } {
  return { text: COMMENT_PREFIX_INSERTION, cursorOffset: COMMENT_PREFIX_INSERTION.length };
}

/**
 * Compose the flat, keyboard-navigable @ menu item list. The comment:
 * prefix partitions the query space: routed queries show commits only;
 * otherwise the prefix suggestion (when the query is empty or a partial
 * "comment" prefix) sits above the regular file matches. Quoted tokens
 * (@"…) stay file-only — shas never contain spaces, so quoting is noise.
 */
export function buildAtMenuItems(opts: {
  query: string | null;
  quoted: boolean;
  commits: CommentCommitRef[] | null;
  fileMatches: FileIndexEntry[];
  limit: number;
}): AtMenuItem[] {
  if (opts.quoted) return opts.fileMatches.map((entry) => ({ kind: "file", entry }));
  const filter = parseCommentQuery(opts.query);
  if (filter !== null) {
    if (opts.commits === null) return [];
    // Commits are capped by the fetch size (COMMENT_FETCH_LIMIT), not by the
    // file-result limit — the user asked for commits, show every fetched one.
    return filterCommentCommits(opts.commits, filter, COMMENT_FETCH_LIMIT)
      .map((commit) => ({ kind: "commit", commit }));
  }
  const items: AtMenuItem[] = [];
  if (isCommentPrefixQuery(opts.query)) items.push({ kind: "prefix" });
  for (const entry of opts.fileMatches) items.push({ kind: "file", entry });
  return items;
}
