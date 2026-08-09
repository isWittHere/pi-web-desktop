"use client";

// Shared, cached access to the project file index and loaded skill metadata,
// used to decide whether @file / /skill: mentions are valid enough to
// highlight. Module-level cache + external store so every user message in a
// session shares one fetch instead of firing one request per bubble.

import { useEffect, useSyncExternalStore } from "react";
import { buildEntriesFromFiles } from "@/lib/file-fuzzy";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";

export interface FileIndexSnapshot {
  cwd: string;
  /** Lowercased cwd-relative paths (files) and dirs, no trailing "/" */
  paths: Set<string>;
  dirs: Set<string>;
  /** True when the listing hit the server's cap — misses may be false negatives */
  truncated: boolean;
}

export interface SkillInfoSnapshot {
  cwd: string;
  /** skill name → metadata (description, filePath, baseDir) */
  skills: Map<string, SkillInfo>;
}

const INDEX_TTL_MS = 30_000;
const SKILLS_TTL_MS = 30_000;

const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const indexSnapshots = new Map<string, FileIndexSnapshot>();
const indexFetchedAt = new Map<string, number>();
const indexInflight = new Map<string, Promise<FileIndexSnapshot | null>>();

async function fetchFileIndex(cwd: string): Promise<FileIndexSnapshot | null> {
  const existing = indexInflight.get(cwd);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { files?: string[]; truncated?: boolean };
      const entries = buildEntriesFromFiles(data.files ?? []);
      const snapshot: FileIndexSnapshot = {
        cwd,
        paths: new Set(entries.filter((e) => !e.isDir).map((e) => e.path.toLowerCase())),
        dirs: new Set(entries.filter((e) => e.isDir).map((e) => e.path.toLowerCase())),
        truncated: !!data.truncated,
      };
      indexSnapshots.set(cwd, snapshot);
      indexFetchedAt.set(cwd, Date.now());
      notify();
      return snapshot;
    } catch {
      return null;
    } finally {
      indexInflight.delete(cwd);
    }
  })();
  indexInflight.set(cwd, request);
  return request;
}

const skillSnapshots = new Map<string, SkillInfoSnapshot>();
const skillsFetchedAt = new Map<string, number>();
const skillsInflight = new Map<string, Promise<SkillInfoSnapshot | null>>();

async function fetchSkillInfo(cwd: string): Promise<SkillInfoSnapshot | null> {
  const existing = skillsInflight.get(cwd);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      if (!response.ok) return null;
      const data = (await response.json()) as SkillsResponse;
      const snapshot: SkillInfoSnapshot = {
        cwd,
        skills: new Map(data.skills.map((skill) => [skill.name, skill])),
      };
      skillSnapshots.set(cwd, snapshot);
      skillsFetchedAt.set(cwd, Date.now());
      notify();
      return snapshot;
    } catch {
      return null;
    } finally {
      skillsInflight.delete(cwd);
    }
  })();
  skillsInflight.set(cwd, request);
  return request;
}

/**
 * The project file index for a cwd, or null while unknown. Refetches at most
 * once per TTL per cwd; concurrent subscribers share one request.
 */
export function useFileIndex(cwd?: string | null): FileIndexSnapshot | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (cwd ? (indexSnapshots.get(cwd) ?? null) : null),
  );
  useEffect(() => {
    if (!cwd) return;
    const fetchedAt = indexFetchedAt.get(cwd);
    if (fetchedAt !== undefined && Date.now() - fetchedAt < INDEX_TTL_MS) return;
    void fetchFileIndex(cwd);
  }, [cwd]);
  return snapshot;
}

/**
 * The loaded skill metadata for a cwd (settings skills, package skills,
 * project .agents/skills — the same view the runtime uses).
 * Returns name → SkillInfo, or null while unknown.
 */
export function useSkillInfo(cwd?: string | null): Map<string, SkillInfo> | null {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (cwd ? (skillSnapshots.get(cwd) ?? null) : null),
  );
  useEffect(() => {
    if (!cwd) return;
    const fetchedAt = skillsFetchedAt.get(cwd);
    if (fetchedAt !== undefined && Date.now() - fetchedAt < SKILLS_TTL_MS) return;
    void fetchSkillInfo(cwd);
  }, [cwd]);
  return snapshot ? snapshot.skills : null;
}

/**
 * The loaded skill names for a cwd. null while unknown.
 */
export function useSkillNames(cwd?: string | null): Set<string> | null {
  const skills = useSkillInfo(cwd);
  return skills ? new Set(skills.keys()) : null;
}
