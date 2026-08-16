"use client";

import { useCallback, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

/**
 * The two workspace-opening actions shared by the picker menus and the
 * welcome lobby, so every entry point behaves identically:
 *
 * - "Select folder": opens the native directory picker on desktop, or an
 *   inline path input in the browser; the chosen path is validated through
 *   /api/cwd/validate (which registers the file allow-root) before it is
 *   opened.
 * - "Quick workspace": asks the server for a scratch workspace
 *   (~/pi-cwd-<YYYYMMDD> via /api/default-cwd) and opens it.
 *
 * Both call `onOpenProject(project)` with the resolved path, which routes
 * through the normal workspace-open chain.
 */

export interface WorkspaceActions {
  /** "Select folder" — desktop picker, or inline input when unavailable. */
  openFolderPicker: () => void;
  /** "Quick workspace" — server scratch workspace. */
  openQuickWorkspace: () => void;
  /** Validates and opens a typed path (Enter in the inline input). */
  commitCustomPath: (candidate?: string) => void;
  /** Closes and clears the inline path input. */
  cancelCustomPath: () => void;
  customPathOpen: boolean;
  customPathValue: string;
  setCustomPathValue: Dispatch<SetStateAction<string>>;
  customPathError: string | null;
  setCustomPathError: Dispatch<SetStateAction<string | null>>;
  customPathValidating: boolean;
  customPathInputRef: RefObject<HTMLInputElement | null>;
}

export function useWorkspaceActions(onOpenProject: (project: string) => void): WorkspaceActions {
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const customPathInputRef = useRef<HTMLInputElement>(null);

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setCustomPathOpen(false);
      setCustomPathValue("");
      onOpenProject(data.cwd ?? path);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating, onOpenProject]);

  const openFolderPicker = useCallback(async () => {
    const desktop = window.piDesktop;
    if (!desktop) {
      setCustomPathOpen(true);
      setCustomPathError(null);
      setTimeout(() => customPathInputRef.current?.focus(), 0);
      return;
    }

    try {
      setCustomPathError(null);
      const path = await desktop.selectDirectory();
      if (path === null) return;

      setCustomPathValue(path);
      setCustomPathOpen(true);
      await commitCustomPath(path);
    } catch (e) {
      setCustomPathOpen(true);
      setCustomPathError(e instanceof Error ? e.message : String(e));
      setTimeout(() => customPathInputRef.current?.focus(), 0);
    }
  }, [commitCustomPath]);

  const openQuickWorkspace = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) onOpenProject(data.cwd);
    } catch {
      // ignore
    }
  }, [onOpenProject]);

  const cancelCustomPath = useCallback(() => {
    setCustomPathOpen(false);
    setCustomPathValue("");
    setCustomPathError(null);
  }, []);

  return {
    openFolderPicker,
    openQuickWorkspace,
    commitCustomPath,
    cancelCustomPath,
    customPathOpen,
    customPathValue,
    setCustomPathValue,
    customPathError,
    setCustomPathError,
    customPathValidating,
    customPathInputRef,
  };
}
