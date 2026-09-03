/**
 * Workspace switch notification decision — pure logic, no React dependency.
 *
 * The shell (AppShell) owns the effective workspace; the sidebar mirrors it.
 * Switch requests flow shell → sidebar as a tokened object; notifications
 * flow back through onCwdChange. A notification must fire when the effective
 * cwd *changes* (sidebar-internal selection) or when a *new shell request*
 * arrives for the cwd already in effect. The second case is what lets a
 * re-issued switch (e.g. re-clicking the active workspace tab as a recovery
 * gesture) reach the shell instead of being silently deduplicated by a value
 * comparison — value-only dedupe created dead states where no tab click
 * could ever trigger a workspace switch again.
 */

export interface WorkspaceSwitchRequest {
  cwd: string | null;
  projectKey?: string | null;
  token: number;
}

export interface SwitchNotifyState {
  /** Effective cwd at the time of the last emitted notification. */
  lastNotifiedCwd: string | null;
  /** Token of the last switch request this mirror consumed. */
  lastConsumedToken: number;
}

export interface SwitchNotifyDecision {
  notify: boolean;
  lastNotifiedCwd: string | null;
  lastConsumedToken: number;
}

/**
 * Decide whether the sidebar must emit onCwdChange for the current state.
 *
 * A pending request counts as consumed only once its cwd is in effect: the
 * apply effect may not have run yet when this decision is made (the notify
 * effect is declared before the apply effect), in which case the
 * notification waits for the changed-cwd pass that follows the apply.
 */
export function shouldNotifyCwdChange(
  selectedCwd: string | null,
  request: WorkspaceSwitchRequest | null | undefined,
  state: SwitchNotifyState,
): SwitchNotifyDecision {
  if (
    request != null
    && request.token !== state.lastConsumedToken
    && request.cwd === selectedCwd
  ) {
    // New shell request whose cwd is already in effect (re-issued switch):
    // re-notify so the shell re-runs its switch machine, and consume it so
    // it fires exactly once.
    return { notify: true, lastNotifiedCwd: selectedCwd, lastConsumedToken: request.token };
  }
  const cwdChanged = state.lastNotifiedCwd !== selectedCwd;
  return {
    notify: cwdChanged,
    lastNotifiedCwd: selectedCwd,
    lastConsumedToken: state.lastConsumedToken,
  };
}
