"use client";

import { useCallback, useState } from "react";
import {
  activateTab as activateTabOp,
  closeTab as closeTabOp,
  EMPTY_WORKSPACE_TABS,
  openWorkspace as openWorkspaceOp,
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

  const open = useCallback((key: string, cwd: string, branch?: string | null) => {
    setState((s) => openWorkspaceOp(s, key, cwd, branch));
  }, []);
  const close = useCallback((key: string) => {
    setState((s) => closeTabOp(s, key));
  }, []);
  const activate = useCallback((key: string) => {
    setState((s) => activateTabOp(s, key));
  }, []);
  const updateCwd = useCallback((key: string, cwd: string, branch?: string | null) => {
    setState((s) => updateTabCwdOp(s, key, cwd, branch));
  }, []);
  const resetToSingle = useCallback((cwd: string, key: string, branch?: string | null) => {
    setState(resetToSingleOp(cwd, key, branch));
  }, []);
  const clear = useCallback(() => {
    setState(EMPTY_WORKSPACE_TABS);
  }, []);

  return { state, open, close, activate, updateCwd, resetToSingle, clear };
}
