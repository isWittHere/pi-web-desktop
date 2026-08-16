"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * Shared running/unread activity indicators — the exact visuals the workspace
 * picker menus use, so any surface that lists workspaces (picker, welcome
 * lobby) shows identical state. Each indicator renders the icon only; callers
 * wrap it with their own count badge when a number is wanted.
 */

export function RunningSessionIndicator() {
  const { t } = useI18n();

  return (
    <span
      title={t("desktop.agentRunning")}
      aria-label={t("desktop.agentRunningLabel")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

export function UnreadSessionIndicator() {
  const { t } = useI18n();

  return (
    <span
      title={t("desktop.newActivity")}
      aria-label={t("desktop.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="3" fill="currentColor">
          <animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}
