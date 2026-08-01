type TimerHandle = number | ReturnType<typeof setTimeout>;

export interface StreamUpdateSchedulerOptions {
  /** Upper bound for UI commits while a stream is producing updates. */
  maxUpdatesPerSecond?: number;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

export interface StreamUpdateScheduler<T> {
  /** Replaces any queued value; only the most recent complete snapshot is committed. */
  enqueue(value: T): void;
  /** Commits the queued snapshot immediately, ignoring the frame-rate limit. */
  flush(): void;
  /** Drops a queued snapshot and cancels scheduled work. */
  reset(): void;
  /** Permanently stops this scheduler. */
  destroy(): void;
}

const DEFAULT_MAX_UPDATES_PER_SECOND = 30;

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Coalesces a burst of append-only stream snapshots into at most one React
 * update per animation frame, with an explicit FPS ceiling. Keeping the whole
 * latest snapshot (instead of reconstructing deltas) also preserves tool-call
 * and thinking-block changes emitted by the Pi SDK.
 */
export function createStreamUpdateScheduler<T>(
  commit: (value: T) => void,
  options: StreamUpdateSchedulerOptions = {},
): StreamUpdateScheduler<T> {
  const maxUpdatesPerSecond = Math.max(1, options.maxUpdatesPerSecond ?? DEFAULT_MAX_UPDATES_PER_SECOND);
  const minIntervalMs = 1000 / maxUpdatesPerSecond;
  const now = options.now ?? defaultNow;
  const requestFrame = options.requestFrame
    ?? (typeof requestAnimationFrame === "function" ? requestAnimationFrame : undefined);
  const cancelFrame = options.cancelFrame
    ?? (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : undefined);
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  let destroyed = false;
  let pending = false;
  let pendingValue: T | undefined;
  let frameHandle: number | null = null;
  let timerHandle: TimerHandle | null = null;
  let lastCommitAt: number | null = null;

  const cancelScheduledWork = () => {
    if (frameHandle !== null) {
      cancelFrame?.(frameHandle);
      frameHandle = null;
    }
    if (timerHandle !== null) {
      clearTimer(timerHandle);
      timerHandle = null;
    }
  };

  const commitPending = (timestamp: number, deferToMicrotask: boolean) => {
    if (!pending || destroyed) return;
    const value = pendingValue as T;
    pending = false;
    pendingValue = undefined;
    lastCommitAt = timestamp;
    const doCommit = () => {
      if (!destroyed) commit(value);
    };
    if (deferToMicrotask && typeof queueMicrotask === "function") {
      // Defer past the current callback stack: dispatching a React state
      // update directly from a rAF/setTimeout callback can nest into a
      // concurrent render pass and trip React's "Maximum update depth
      // exceeded" guard on large streaming sessions.
      queueMicrotask(doCommit);
    } else {
      doCommit();
    }
  };

  const scheduleFrame = () => {
    if (destroyed || !pending || frameHandle !== null || timerHandle !== null) return;
    if (!requestFrame) {
      const elapsed = lastCommitAt === null ? minIntervalMs : now() - lastCommitAt;
      timerHandle = setTimer(() => {
        timerHandle = null;
        commitPending(now(), true);
        scheduleFrame();
      }, Math.max(0, minIntervalMs - elapsed));
      return;
    }
    frameHandle = requestFrame((timestamp) => {
      frameHandle = null;
      if (destroyed || !pending) return;

      const elapsed = lastCommitAt === null ? minIntervalMs : timestamp - lastCommitAt;
      if (elapsed < minIntervalMs) {
        timerHandle = setTimer(() => {
          timerHandle = null;
          scheduleFrame();
        }, minIntervalMs - elapsed);
        return;
      }

      commitPending(timestamp, true);
      scheduleFrame();
    });
  };

  return {
    enqueue(value) {
      if (destroyed) return;
      pendingValue = value;
      pending = true;
      scheduleFrame();
    },
    flush() {
      if (destroyed || !pending) return;
      cancelScheduledWork();
      commitPending(now(), false);
      scheduleFrame();
    },
    reset() {
      cancelScheduledWork();
      pending = false;
      pendingValue = undefined;
      lastCommitAt = null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelScheduledWork();
      pending = false;
      pendingValue = undefined;
    },
  };
}
