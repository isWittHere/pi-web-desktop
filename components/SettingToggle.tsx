"use client";

import type { ReactNode } from "react";

const TOGGLE_WIDTH = 40;
const TOGGLE_HEIGHT = 22;
const THUMB_SIZE = 16;
const THUMB_OFFSET = 3;

const toggleTrackStyle: React.CSSProperties = {
  position: "relative",
  width: TOGGLE_WIDTH,
  height: TOGGLE_HEIGHT,
  borderRadius: TOGGLE_HEIGHT / 2,
  border: "none",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
  transition: "background 0.18s ease",
  outline: "none",
};

const thumbStyle: React.CSSProperties = {
  position: "absolute",
  top: THUMB_OFFSET,
  width: THUMB_SIZE,
  height: THUMB_SIZE,
  borderRadius: "50%",
  background: "#fff",
  transition: "left 0.18s ease, transform 0.18s ease",
  boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
};

export function SettingToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  const trackBg = checked ? "var(--accent)" : "color-mix(in srgb, var(--border) 70%, var(--bg))";
  const thumbLeft = checked ? TOGGLE_WIDTH - THUMB_SIZE - THUMB_OFFSET : THUMB_OFFSET;

  return (
    <label
      style={{
        display: "flex",
        alignItems: description ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 7,
        cursor: "pointer",
        userSelect: "none",
        transition: "background 0.12s",
        margin: "0 -14px",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 550, color: "var(--text)", lineHeight: 1.4 }}>
          {label}
        </span>
        {description && (
          <span style={{ display: "block", fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)", marginTop: 2 }}>
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        style={{
          ...toggleTrackStyle,
          background: trackBg,
        }}
      >
        <span
          style={{
            ...thumbStyle,
            left: thumbLeft,
          }}
        />
      </button>
    </label>
  );
}

export function SettingSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)" }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: "5px 0 14px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
      <div>{children}</div>
    </section>
  );
}
