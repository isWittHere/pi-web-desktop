"use client";

import { useState, useEffect, useCallback } from "react";
import { Moon, PaintBrush, Sun, Monitor, ArrowSquareOut, Link } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import type { ThemeSetInfo } from "@/lib/theme";

// ── Tag / chip helpers ───────────────────────────────────────────────────────

const tagGroupStyle: React.CSSProperties = {
  display: "flex", gap: 6, flexWrap: "wrap",
};

function tagStyle(active: boolean, hovered: boolean, disabled?: boolean): React.CSSProperties {
  const borderColor = active
    ? "var(--accent)"
    : hovered
      ? "var(--border-hover)"
      : "var(--border)";
  const bg = active
    ? "color-mix(in srgb, var(--accent) 12%, var(--bg))"
    : hovered
      ? "var(--bg-hover)"
      : "var(--bg-card)";
  const color = active ? "var(--accent)" : hovered ? "var(--text)" : "var(--text-muted)";

  return {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "7px 14px",
    border: `1px solid ${borderColor}`,
    borderRadius: 8,
    background: bg,
    color,
    fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "border-color 0.15s, background 0.15s, color 0.15s",
    outline: "none", whiteSpace: "nowrap",
  };
}

function SectionLabel({ icon, label, actions }: { icon: React.ReactNode; label: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, width: "100%" }}>
      <span style={{ color: "var(--text-dim)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      {actions && <span style={{ display: "inline-flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>{actions}</span>}
    </div>
  );
}

const textActionButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "var(--accent)",
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Underline the label while hovering a text action button. */
const underlineOnHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.textDecoration = "underline";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.textDecoration = "none";
  },
};

function ConfigSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)" }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: "5px 0 16px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
      {children}
    </section>
  );
}

// ── Border depth icon ───────────────────────────────────────────────────────

function BorderIcon({ depth }: { depth: number }) {
  const n = depth / 100;
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <rect
        x={1.5} y={1.5} width={11} height={11} rx={2.5}
        style={{
          fill: "none",
          stroke: "var(--text-dim)",
          strokeWidth: 1 + n * 2,
          opacity: 0.2 + n * 0.8,
        }}
      />
      <rect
        x={4} y={4} width={6} height={6} rx={1}
        style={{
          fill: "var(--text-dim)",
          opacity: 0.05 + n * 0.35,
        }}
      />
    </svg>
  );
}

// ── Variant availability dots ───────────────────────────────────────────────

function VariantDots({ hasDark, hasLight, t }: { hasDark: boolean; hasLight: boolean; t: (key: string) => string }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
      {hasDark && (
        <span title={t("desktop.darkVariant")} style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#7c6f64" }} />
      )}
      {hasLight && (
        <span title={t("desktop.lightVariant")} style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#d5c4a1", border: "1px solid rgba(0,0,0,0.1)" }} />
      )}
    </span>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function DisplayConfig() {
  const { mode, resolvedMode, themeName, setMode, setTheme, borderDepth, setBorderDepth } = useTheme();
  const { locale: language, setLocale: setLanguage, t } = useI18n();
  const [themeSets, setThemeSets] = useState<ThemeSetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/themes")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { themeSets: ThemeSetInfo[] } | null) => {
        if (cancelled || !data) return;
        setThemeSets(data.themeSets);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleThemeChange = useCallback((name: string) => {
    setApplying(name);
    setTheme(name).finally(() => setApplying(null));
  }, [setTheme]);

  const handleModeChange = useCallback((m: ThemeMode) => {
    setMode(m);
  }, [setMode]);

  const openThemeFolder = useCallback(() => {
    window.piDesktop?.openThemeFolder();
  }, []);

  const openThemeDocs = useCallback(() => {
    if (window.piDesktop) {
      window.piDesktop.openThemeDocs();
      return;
    }
    window.open("https://pi.dev/docs/latest/themes", "_blank", "noopener,noreferrer");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("desktop.display")}</h1>
      </header>

      {/* ── Theme ── */}
      <ConfigSection title={t("desktop.theme")} description={t("desktop.themeDescription")}>
        {/* Color Scheme */}
        <SectionLabel
          icon={<PaintBrush size={14} weight="fill" />}
          label={t("desktop.colorScheme")}
          actions={
            <>
              <button
                type="button"
                onClick={openThemeFolder}
                style={textActionButtonStyle}
                {...underlineOnHover}
              >
                <Link size={12} weight="regular" aria-hidden="true" />
                {t("desktop.openThemeFolder")}
              </button>
              <button
                type="button"
                onClick={openThemeDocs}
                style={textActionButtonStyle}
                {...underlineOnHover}
              >
                <ArrowSquareOut size={12} weight="regular" aria-hidden="true" />
                {t("desktop.learnPiThemes")}
              </button>
            </>
          }
        />
        {loading ? (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("desktop.loadingThemes")}</span>
        ) : (
          <div style={tagGroupStyle}>
            <button
              type="button" onClick={() => handleThemeChange("")} disabled={applying !== null}
              style={tagStyle(themeName === "", hoveredTag === "__default__", applying !== null)}
              onMouseEnter={() => setHoveredTag("__default__")}
              onMouseLeave={() => setHoveredTag(null)}
            >
              {t("desktop.defaultTheme")}
            </button>

            {themeSets.map((ts) => (
              <button
                key={ts.name} type="button"
                onClick={() => handleThemeChange(ts.name)} disabled={applying !== null}
                style={tagStyle(themeName === ts.name, hoveredTag === ts.name, applying === ts.name)}
                onMouseEnter={() => setHoveredTag(ts.name)}
                onMouseLeave={() => setHoveredTag(null)}
              >
                {ts.displayName}
                <VariantDots hasDark={ts.hasDark} hasLight={ts.hasLight} t={t} />
              </button>
            ))}
          </div>
        )}

        {/* Border depth */}
        <div style={{ marginTop: 20 }}>
          <SectionLabel
            icon={<BorderIcon depth={borderDepth} />}
            label={`${t("desktop.borderVisibility")} (${borderDepth})`}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{t("desktop.borderSubtle")}</span>
            <input
              type="range"
              min={0} max={100} step={1}
              value={borderDepth}
              onChange={(e) => setBorderDepth(Number(e.target.value))}
              style={{
                flex: 1,
                accentColor: "var(--accent)",
                height: 6,
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>{t("desktop.borderBold")}</span>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            {[0, 25, 50, 75, 100].map((d) => {
              const active = borderDepth === d;
              const previewBorder = d <= 50
                ? `color-mix(in srgb, var(--border-orig) ${d * 2}%, var(--bg) ${100 - d * 2}%)`
                : `color-mix(in srgb, var(--border-orig) ${100 - (d - 50) * 2}%, var(--text) ${(d - 50) * 2}%)`;
              return (
                <div
                  key={d}
                  onClick={() => setBorderDepth(d)}
                  style={{
                    width: 28, height: 20,
                    border: `2px solid ${active ? "var(--accent)" : previewBorder}`,
                    borderRadius: 5,
                    background: "var(--bg-card)",
                    cursor: "pointer",
                    transition: "border-color 0.1s",
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Appearance Mode */}
        <div style={{ marginTop: 20 }}>
          <SectionLabel
            icon={resolvedMode === "dark" ? <Moon size={14} weight="fill" /> : <Sun size={14} weight="fill" />}
            label={t("desktop.appearanceMode")}
          />
          <div style={tagGroupStyle}>
            {([
              { value: "light" as ThemeMode, icon: <Sun size={15} weight={mode === "light" ? "fill" : "regular"} /> },
              { value: "dark" as ThemeMode, icon: <Moon size={15} weight={mode === "dark" ? "fill" : "regular"} /> },
              { value: "system" as ThemeMode, icon: <Monitor size={15} weight={mode === "system" ? "fill" : "regular"} /> },
            ]).map((opt) => {
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value} type="button" onClick={() => handleModeChange(opt.value)}
                  style={tagStyle(active, hoveredTag === `mode:${opt.value}`)}
                  onMouseEnter={() => setHoveredTag(`mode:${opt.value}`)}
                  onMouseLeave={() => setHoveredTag(null)}
                >
                  {opt.icon}
                  {t(`desktop.${opt.value}`)}
                </button>
              );
            })}
          </div>

        </div>

        {!loading && themeSets.length === 0 && (
          <p style={{ margin: "14px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {t("desktop.noCustomThemes")}{" "}
            {t("desktop.noCustomThemesHint")}{" "}
            <code style={{ fontSize: 10, background: "var(--bg-secondary)", padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)" }}>~/.pi/agent/themes/*.json</code>{" "}
            {t("desktop.noCustomThemesHint2")}
          </p>
        )}
      </ConfigSection>

      {/* ── Language ── */}
      <ConfigSection title={t("desktop.language")} description={t("desktop.languageDescription")}>
        <div style={tagGroupStyle}>
          {(["en", "zh-CN"] as const).map((lang) => {
            const active = (lang === "zh-CN") ? language === "zh-CN" : language !== "zh-CN";
            return (
              <button
                key={lang} type="button"
                onClick={() => setLanguage(lang === "zh-CN" ? "zh-CN" : "en")}
                style={tagStyle(active, hoveredTag === `lang:${lang}`)}
                onMouseEnter={() => setHoveredTag(`lang:${lang}`)}
                onMouseLeave={() => setHoveredTag(null)}
              >
                {lang === "en" ? t("desktop.english") : t("desktop.chinese")}
              </button>
            );
          })}
        </div>
      </ConfigSection>
    </div>
  );
}
