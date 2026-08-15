"use client";

import { useCallback, useState } from "react";
import {
  activateTab as activateTabOp,
  closeTab as closeTabOp,
  EMPTY_WORKSPACE_TABS,
  openWorkspace as openWorkspaceOp,
  reorderTab as reorderTabOp,
  resetToSingle as resetToSingleOp,
  updateTabCwd as updateTabCwdOp,
  type WorkspaceTabsState,
} from "@/lib/workspace-tabs";

/**
 * Workspace tab state for the tabs view mode. The operations are pure
 * functions in lib/workspace-tabs.ts (unit-tested); this hook only hosts
 * the React state. Not persisted: after a restart the app returns to the
 * single-tab classic behavior (last active workspace), matching the
 * pre-tabs behavior.
 */
export function useWorkspaceTabs() {
  const [state, setState] = useState<WorkspaceTabsState>(EMPTY_WORKSPACE_TABS);

  const open = useCallback((key: string, cwd: string) => {
    setState((s) => openWorkspaceOp(s, key, cwd));
  }, []);
  const close = useCallback((key: string) => {
    setState((s) => closeTabOp(s, key));
  }, []);
  const activate = useCallback((key: string) => {
    setState((s) => activateTabOp(s, key));
  }, []);
  const updateCwd = useCallback((key: string, cwd: string) => {
    setState((s) => updateTabCwdOp(s, key, cwd));
  }, []);
  const reorder = useCallback((fromKey: string, targetKey: string, position: "before" | "after") => {
    setState((s) => reorderTabOp(s, fromKey, targetKey, position));
  }, []);
  const resetToSingle = useCallback((cwd: string, key: string) => {
    setState(resetToSingleOp(cwd, key));
  }, []);
  const clear = useCallback(() => {
    setState(EMPTY_WORKSPACE_TABS);
  }, []);

  return { state, open, close, activate, updateCwd, reorder, resetToSingle, clear };
}
