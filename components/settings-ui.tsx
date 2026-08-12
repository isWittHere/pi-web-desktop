"use client";

import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";

/**
 * Shared control primitives for the settings dialogs and panels.
 *
 * All metrics come from the design tokens in globals.css
 * (--control-height / --control-radius / --control-pad-x and the
 * --status-* semantic colors), so every settings surface renders
 * with the same height, radius, padding and font size, and follows
 * the active pi CLI theme.
 */

export const inputStyle: CSSProperties = {
  height: "var(--control-height)",
  padding: "0 var(--control-pad-x)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--control-radius)",
  color: "var(--text)",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

/** Field wrapper: small muted label above the control. */
export function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

export function SettingsInput({
  value,
  onChange,
  placeholder,
  mono,
  type = "text",
  style,
  onKeyDown,
  onBlur,
  onPaste,
  id,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
  style?: CSSProperties;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  id?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <input
      id={id}
      ref={inputRef}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onPaste={onPaste}
      placeholder={placeholder}
      style={{ ...inputStyle, fontFamily: mono ? "var(--font-mono)" : "inherit", ...style }}
    />
  );
}

export function SettingsNumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />;
}

/** Secret input with a show/hide toggle inside the field. */
export function SettingsSecretInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
  showLabel = "Show",
  hideLabel = "Hide",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: CSSProperties;
  showLabel?: string;
  hideLabel?: string;
}) {
  const [visible, setVisible] = useState(false);

  // Reset visibility when the value is cleared (e.g. switching providers).
  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 34, fontFamily: mono ? "var(--font-mono)" : "inherit" }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        style={{
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
          width: 24,
          height: 24,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visible ? <EyeSlash size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export function SettingsSelect({
  value,
  onChange,
  options,
  required,
  emptyLabel,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Plain string options, or { value, label } pairs when the label differs from the value. */
  options: readonly (string | { value: string; label: string })[];
  required?: boolean;
  /** Label for the empty "inherit / none" option. */
  emptyLabel?: string;
  style?: CSSProperties;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, color: value ? "var(--text)" : "var(--text-dim)", cursor: "pointer", ...style }}
    >
      {!required && <option value="">{emptyLabel ?? ""}</option>}
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        return <option key={opt.value} value={opt.value}>{opt.label}</option>;
      })}
    </select>
  );
}

type ButtonVariant = "default" | "primary" | "danger" | "text";
type ButtonSize = "md" | "sm";

const buttonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  borderRadius: "var(--control-radius)",
  cursor: "pointer",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
  transition: "background 0.12s, border-color 0.12s, color 0.12s",
  whiteSpace: "nowrap",
};

function buttonVariantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case "primary":
      return { background: "var(--accent)", border: "none", color: "#fff", fontWeight: 600 };
    case "danger":
      return {
        background: "color-mix(in srgb, var(--status-danger) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--status-danger) 30%, transparent)",
        color: "var(--status-danger)",
      };
    case "text":
      return { background: "transparent", border: "none", color: "var(--accent)", padding: 0 };
    default:
      return { background: "none", border: "1px solid var(--border)", color: "var(--text-muted)" };
  }
}

function buttonSizeStyle(size: ButtonSize): CSSProperties {
  if (size === "sm") return { height: 24, padding: "0 8px", fontSize: 11 };
  return { height: "var(--control-height)", padding: "0 12px" };
}

export function SettingsButton({
  variant = "default",
  size = "md",
  type = "button",
  disabled,
  onClick,
  title,
  children,
  style,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...buttonBase,
        ...buttonVariantStyle(variant),
        ...buttonSizeStyle(size),
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

type BadgeTone = "default" | "project" | "warning" | "danger" | "success" | "muted";

export function SettingsBadge({ tone = "default", children }: { tone?: BadgeTone; children: ReactNode }) {
  const styles: Record<BadgeTone, CSSProperties> = {
    default: {
      background: "color-mix(in srgb, var(--text-dim) 12%, transparent)",
      color: "var(--text-dim)",
    },
    project: {
      background: "color-mix(in srgb, var(--accent-blue) 12%, transparent)",
      color: "var(--accent-blue)",
    },
    warning: {
      background: "color-mix(in srgb, var(--status-warning) 12%, transparent)",
      color: "var(--status-warning)",
    },
    danger: {
      background: "color-mix(in srgb, var(--status-danger) 12%, transparent)",
      color: "var(--status-danger)",
    },
    success: {
      background: "color-mix(in srgb, var(--status-success) 12%, transparent)",
      color: "var(--status-success)",
    },
    muted: {
      background: "color-mix(in srgb, var(--text-dim) 8%, transparent)",
      color: "var(--text-dim)",
    },
  };
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        flexShrink: 0,
        ...styles[tone],
      }}
    >
      {children}
    </span>
  );
}
