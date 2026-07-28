"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Moon, PaintBrush, Sun, Monitor } from "@phosphor-icons/react";
import { useLanguage } from "@/hooks/useLanguage";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import type { ThemeSetInfo } from "@/lib/theme";

// ── Tag / chip helpers ───────────────────────────────────────────────────────

const tagGroupStyle: React.CSSProperties = {
  display: "flex", gap: 6, flexWrap: "wrap",
};

function tagStyle(active: boolean, disabled?: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "7px 14px",
    border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
    borderRadius: 8,
    background: active ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg-card)",
    color: active ? "var(--accent)" : "var(--text-muted)",
    fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "border-color 0.15s, background 0.15s, color 0.15s",
    outline: "none", whiteSpace: "nowrap",
  };
}

function tagHover(active: boolean): React.CSSProperties {
  if (active) return {};
  return { borderColor: "var(--border-hover)", background: "var(--bg-hover)", color: "var(--text)" };
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ color: "var(--text-dim)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
    </div>
  );
}

function ConfigSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)" }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: "5px 0 16px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
      {children}
    </section>
  );
}

// ── Variant availability dots ───────────────────────────────────────────────

function VariantDots({ hasDark, hasLight }: { hasDark: boolean; hasLight: boolean }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
      {hasDark && (
        <span title="Dark variant available" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#7c6f64" }} />
      )}
      {hasLight && (
        <span title="Light variant available" style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#d5c4a1", border: "1px solid rgba(0,0,0,0.1)" }} />
      )}
    </span>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function DisplayConfig() {
  const { mode, resolvedMode, themeName, setMode, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [themeSets, setThemeSets] = useState<ThemeSetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

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

  const modeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <Sun size={15} weight={mode === "light" ? "fill" : "regular"} /> },
    { value: "dark", label: "Dark", icon: <Moon size={15} weight={mode === "dark" ? "fill" : "regular"} /> },
    { value: "system", label: "System", icon: <Monitor size={15} weight={mode === "system" ? "fill" : "regular"} /> },
  ];

  const resolvedLabel = resolvedMode === "dark" ? "Dark" : "Light";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("display")}</h1>
      </header>

      {/* ── Theme (pick theme set) ── */}
      <ConfigSection title={t("theme")} description={t("themeDescription")}>
        <SectionLabel icon={<PaintBrush size={14} weight="fill" />} label="Color Scheme" />
        {loading ? (
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading themes…</span>
        ) : (
          <div style={tagGroupStyle}>
            {/* Default (built-in) */}
            <button
              type="button" onClick={() => handleThemeChange("")} disabled={applying !== null}
              style={tagStyle(themeName === "", applying !== null)}
              onMouseEnter={(e) => { if (themeName !== "") Object.assign(e.currentTarget.style, tagHover(false)); }}
              onMouseLeave={(e) => { if (themeName !== "") { e.currentTarget.style.borderColor = ""; e.currentTarget.style.background = ""; e.currentTarget.style.color = ""; } }}
            >
              Default
            </button>

            {/* Custom theme sets */}
            {themeSets.map((ts) => (
              <button
                key={ts.name} type="button"
                onClick={() => handleThemeChange(ts.name)} disabled={applying !== null}
                style={tagStyle(themeName === ts.name, applying === ts.name)}
                onMouseEnter={(e) => { if (themeName !== ts.name) Object.assign(e.currentTarget.style, tagHover(false)); }}
                onMouseLeave={(e) => { if (themeName !== ts.name) { e.currentTarget.style.borderColor = ""; e.currentTarget.style.background = ""; e.currentTarget.style.color = ""; } }}
              >
                {ts.displayName}
                <VariantDots hasDark={ts.hasDark} hasLight={ts.hasLight} />
              </button>
            ))}
          </div>
        )}

        {/* ── Mode selector ── */}
        <div style={{ marginTop: 20 }}>
          <SectionLabel
            icon={resolvedMode === "dark" ? <Moon size={14} weight="fill" /> : <Sun size={14} weight="fill" />}
            label="Appearance Mode"
          />
          <div style={tagGroupStyle}>
            {modeOptions.map((opt) => {
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value} type="button" onClick={() => handleModeChange(opt.value)}
                  style={tagStyle(active)}
                  onMouseEnter={(e) => { if (!active) Object.assign(e.currentTarget.style, tagHover(active)); }}
                  onMouseLeave={(e) => { if (!active) { e.currentTarget.style.borderColor = ""; e.currentTarget.style.background = ""; e.currentTarget.style.color = ""; } }}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {mode === "system"
              ? `Following system preference. Currently using ${resolvedLabel} mode.`
              : `${resolvedLabel} mode active${themeName ? ` with «${themeName}» theme` : ""}.`}
          </p>
        </div>

        {!loading && themeSets.length === 0 && (
          <p style={{ margin: "14px 0 0", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            No custom themes installed. Add <code style={{ fontSize: 10, background: "var(--bg-secondary)", padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)" }}>~/.pi/agent/themes/*.json</code> to see them here.
          </p>
        )}
      </ConfigSection>

      {/* ── Language ── */}
      <ConfigSection title={t("language")} description={t("languageDescription")}>
        <div style={tagGroupStyle}>
          {(["en", "zh-CN"] as const).map((lang) => {
            const active = (lang === "zh-CN") ? language === "zh-CN" : language !== "zh-CN";
            return (
              <button
                key={lang} type="button"
                onClick={() => setLanguage(lang === "zh-CN" ? "zh-CN" : "en")}
                style={tagStyle(active)}
                onMouseEnter={(e) => { if (!active) Object.assign(e.currentTarget.style, tagHover(active)); }}
                onMouseLeave={(e) => { if (!active) { e.currentTarget.style.borderColor = ""; e.currentTarget.style.background = ""; e.currentTarget.style.color = ""; } }}
              >
                {lang === "en" ? "English" : "中文"}
              </button>
            );
          })}
        </div>
      </ConfigSection>
    </div>
  );
}
