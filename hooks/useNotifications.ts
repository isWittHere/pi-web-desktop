"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NOTIFICATION_DURATION_KEY, type NotificationDuration as NotificationDurationSetting } from "@/components/ChatConfig";

// Screen-level completion notifications.
//
// When a task finishes while the user is not focused on the app, we ask the
// Electron main process (via the preload bridge) to show a small frameless
// popup at the top-right of the display. The main process decides whether to
// actually show it (it stays silent when the app is focused, since the user
// can see the chat stream anyway); the renderer only supplies content and the
// current theme CSS variables so the popup matches the active pi CLI theme.
//
// In plain browser mode (window.piDesktop is undefined) this degrades to a
// no-op — no system notification, no error.

// Content of the popup card. title is the bold first line; the rest are
// muted detail lines (workspace/branch, model, usage). Layout mirrors the
// user's requested shape:
//   <session title>
//   <workspace> · <branch>
//   <model>
//   <cost>  <context>
export interface NotificationDonePayload {
  sessionId?: string;
  title: string;
  workspace?: string;
  model?: string;
  usage?: string;
}

// Popup display duration, read from the chat settings (default 60s).
// "forever" keeps the card until the user hovers away/dismisses it.
export type { NotificationDurationSetting };

export function getNotificationDurationSetting(): NotificationDurationSetting {
  try {
    const stored = localStorage.getItem(NOTIFICATION_DURATION_KEY);
    return stored === "60" || stored === "180" || stored === "300" || stored === "forever" ? stored : "60";
  } catch {
    return "60";
  }
}

// CSS variables read from <html> and pushed to the popup window. Only the
// colors the popup actually uses (surface, text, accent).
const POPUP_CSS_VARS = [
  "--bg-card",
  "--text",
  "--text-muted",
  "--accent",
] as const;

function collectPopupCssVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (typeof document === "undefined") return vars;
  const style = getComputedStyle(document.documentElement);
  for (const name of POPUP_CSS_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return vars;
}

export function useNotifications() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("pi-notification-enabled");
    return stored === null ? true : stored === "true";
  });

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    localStorage.setItem("pi-notification-enabled", String(next));
    setEnabled(next);
  }, []);

  /**
   * Request a screen-level notification. No-op when notifications are
   * disabled, the app runs in a plain browser, or the main process decides
   * the app is focused.
   */
  const notifyDone = useCallback((payload: NotificationDonePayload) => {
    if (!enabledRef.current) return;
    // Plain browser mode (window.piDesktop is undefined) — screen-level
    // popups belong to the Electron shell only; degrade silently.
    if (typeof window === "undefined" || !window.piDesktop?.showNotification) return;
    void window.piDesktop
      .showNotification({
        sessionId: payload.sessionId,
        title: payload.title,
        detail: [payload.workspace, payload.model, payload.usage].filter(Boolean).join("\n"),
        duration: getNotificationDurationSetting(),
        cssVars: collectPopupCssVars(),
      })
      .catch((err) => {
        // IPC bridge unavailable (e.g. popup torn down) — degrade silently.
        console.warn("[notify] ipc error:", String(err));
      });
  }, []);

  return {
    notificationsEnabled: enabled,
    onNotificationsToggle: toggle,
    notifyDone,
  };
}
