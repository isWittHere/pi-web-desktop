"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
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
  width: "100%",
  boxSizing: "border-box",
};

/**
 * Settings section: title + description + controls as a flat full-width
 * block separated from the next section by a hairline divider. This is the
 * classic settings-page rhythm — sections stack with a `borderBottom` line.
 */
export function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section
      style={{
        padding: "var(--settings-section-gap) var(--settings-pad-x)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: "5px 0 14px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
      <div>{children}</div>
    </section>
  );
}

/** Page root: the page header sits in the dialog shell, the page body
 * scrolls inside SettingsModal — this root only participates in flex. */
export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      {children}
    </div>
  );
}

/** Page header: title + one-line description, with optional aside info
 * (scope markers, config file paths). Rendered by SettingsModal so every
 * page shares the same rhythm. */
export function SettingsPageHeader({ title, description, aside }: { title: string; description: string; aside?: ReactNode }) {
  return (
    <div
      style={{
        padding: "16px var(--settings-pad-x) 12px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)", minWidth: 0 }}>{title}</h2>
        {aside && <div style={{ flexShrink: 0, minWidth: 0 }}>{aside}</div>}
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
    </div>
  );
}

/** Settings group: an uppercase section label above a set of setting rows. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        padding: "var(--settings-section-gap) var(--settings-pad-x)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

/** Settings row: label column (title + one-line result-oriented description)
 * on the left, the single control on the right. One row = one setting. */
export function SettingsRow({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">
        <span style={{ display: "block", fontSize: 13, fontWeight: 550, color: "var(--text)", lineHeight: 1.4 }}>{label}</span>
        {description && (
          <span style={{ display: "block", fontSize: 11, lineHeight: 1.5, color: "var(--text-muted)", marginTop: 2 }}>{description}</span>
        )}
      </span>
      <span className="settings-row-control">{control}</span>
    </div>
  );
}

/** Segmented option — one mutually-exclusive choice inside the control. */
export interface SegmentedOption {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
}

/**
 * Segmented control for mutually-exclusive choices (mode, scope, view).
 * A single bordered track, selected option as an inset highlight — the
 * value readout of a setting, distinct from action buttons. Implements
 * radiogroup semantics with arrow-key navigation.
 */
export function SegmentedControl({
  value,
  onChange,
  options,
  size = "md",
  ariaLabel,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SegmentedOption[];
  size?: "sm" | "md";
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const [focusIndex, setFocusIndex] = useState(selectedIndex);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Keep the roaming tab stop in sync with external value changes so the
  // wrong option never claims the tab position after a controlled update.
  useEffect(() => {
    setFocusIndex(selectedIndex);
  }, [selectedIndex]);

  const focusEnabled = (from: number, delta: number) => {
    const enabled = options.map((o) => !o.disabled);
    if (delta === 0 || !enabled.some(Boolean)) return;
    let index = from;
    for (let step = 0; step < options.length; step += 1) {
      index = (index + delta + options.length) % options.length;
      if (enabled[index]) break;
    }
    if (enabled[index]) {
      setFocusIndex(index);
      refs.current[index]?.focus();
    }
  };

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusEnabled(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusEnabled(index, -1);
        break;
      case "Home":
        event.preventDefault();
        focusEnabled(index, -options.length);
        break;
      case "End":
        event.preventDefault();
        focusEnabled(index, options.length);
        break;
      default:
        break;
    }
  };

  const height = size === "sm" ? 24 : "var(--control-height)";
  const padding = size === "sm" ? "0 10px" : "0 12px";
  const fontSize = size === "sm" ? 11 : 12.5;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        background: "var(--control-container-bg)",
        border: `1px solid var(--control-container-border)`,
        borderRadius: "var(--control-radius)",
        padding: 2,
        gap: 2,
        flexWrap: "nowrap",
        ...style,
      }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.title ?? option.label}
            disabled={option.disabled}
            tabIndex={index === focusIndex ? 0 : -1}
            ref={(element) => {
              refs.current[index] = element;
            }}
            onClick={() => onChange(option.value)}
            onKeyDown={handleKeyDown(index)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height,
              padding,
              border: "none",
              borderRadius: "calc(var(--control-radius) - 2px)",
              background: selected ? "var(--control-option-active-bg)" : "transparent",
              color: selected ? "var(--control-option-active-text)" : "var(--control-option-text)",
              fontWeight: selected ? 600 : 400,
              fontSize,
              whiteSpace: "nowrap",
              cursor: option.disabled ? "not-allowed" : "pointer",
              opacity: option.disabled ? 0.45 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(event) => {
              if (!selected && !option.disabled) {
                event.currentTarget.style.background = "var(--control-option-hover-bg)";
                event.currentTarget.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(event) => {
              if (!selected && !option.disabled) {
                event.currentTarget.style.background = "transparent";
                event.currentTarget.style.color = "var(--control-option-text)";
              }
            }}
          >
            {option.icon && <span style={{ display: "inline-flex", flexShrink: 0 }} aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

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
  emptyLabel,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Plain string options, or { value, label } pairs when the label differs from the value. */
  options: readonly (string | { value: string; label: string })[];
  /** Label for the empty "inherit / none" option. Only rendered when provided. */
  emptyLabel?: string;
  style?: CSSProperties;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, color: value ? "var(--text)" : "var(--text-dim)", cursor: "pointer", ...style }}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        return <option key={opt.value} value={opt.value}>{opt.label}</option>;
      })}
    </select>
  );
}

type ButtonVariant = "default" | "primary" | "danger";
type ButtonSize = "md" | "sm";

const buttonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  borderRadius: "var(--control-radius)",
  cursor: "pointer",
  fontSize: 12,
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

type BadgeTone = "default" | "project" | "warning" | "muted";

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
