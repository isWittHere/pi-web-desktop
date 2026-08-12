"use client";

import { Toggle } from "./Toggle";

/** Row layout: label + description on the left, switch on the right. */
export function SettingToggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  loading,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: description ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 7,
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        transition: "background 0.12s",
        margin: "0 -14px",
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 550,
            color: "var(--text)",
            lineHeight: 1.4,
            opacity: disabled ? 0.55 : 1,
          }}
        >
          {label}
        </span>
        {description && (
          <span
            style={{
              display: "block",
              fontSize: 11,
              lineHeight: 1.5,
              color: "var(--text-muted)",
              marginTop: 2,
              opacity: disabled ? 0.55 : 1,
            }}
          >
            {description}
          </span>
        )}
      </span>
      <Toggle
        checked={checked}
        onChange={onChange}
        label={label}
        disabled={disabled}
        loading={loading}
      />
    </label>
  );
}
