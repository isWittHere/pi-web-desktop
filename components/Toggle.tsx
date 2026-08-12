"use client";

/**
 * Shared switch control for settings panels and list rows.
 *
 * Unifies the previously duplicated toggles in SettingToggle.tsx,
 * PluginsConfig.tsx and SkillsConfig.tsx into one implementation:
 * 40×22 pill track, 16px thumb, accent when on. Uses `role="switch"`
 * with `aria-checked` so screen readers announce the checked state.
 */
const TOGGLE_WIDTH = 40;
const TOGGLE_HEIGHT = 22;
const THUMB_SIZE = 16;
const THUMB_OFFSET = 3;

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  loading,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name — used for aria-label and the hover title. */
  label: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const busy = loading === true;
  const blocked = disabled || busy;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={blocked}
      aria-label={label}
      title={label}
      onClick={() => {
        if (!blocked) onChange(!checked);
      }}
      style={{
        flexShrink: 0,
        width: TOGGLE_WIDTH,
        height: TOGGLE_HEIGHT,
        borderRadius: TOGGLE_HEIGHT / 2,
        border: "none",
        padding: 0,
        cursor: busy ? "wait" : disabled ? "not-allowed" : "pointer",
        background: checked
          ? "var(--accent)"
          : "color-mix(in srgb, var(--border) 70%, var(--bg))",
        position: "relative",
        transition: "background 0.18s ease",
        opacity: busy ? 0.65 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: THUMB_OFFSET,
          left: checked
            ? TOGGLE_WIDTH - THUMB_SIZE - THUMB_OFFSET
            : THUMB_OFFSET,
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left 0.18s ease, transform 0.18s ease",
        }}
      />
    </button>
  );
}
