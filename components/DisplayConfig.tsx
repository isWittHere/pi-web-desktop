"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Moon, Sun } from "@phosphor-icons/react";
import { useLanguage } from "@/hooks/useLanguage";
import { useTheme } from "@/hooks/useTheme";
import type { ThemeInfo } from "@/lib/theme";

// ── Shared tag/chip styles ───────────────────────────────────────────────────

const tagGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

function tagStyle(active: boolean, disabled?: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 14px",
    border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
    borderRadius: 8,
    background: active ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg-card)",
    color: active ? "var(--accent)" : "var(--text-muted)",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "border-color 0.15s, background 0.15s, color 0.15s",
    outline: "none",
    whiteSpace: "nowrap",
  };
}

function tagHoverStyle(active: boolean): React.CSSProperties {
  if (active) return {};
  return {
    borderColor: "var(--border-hover)",
    background: "var(--bg-hover)",
    color: "var(--text)",
  };
}

// ── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ color: "var(--text-dim)", display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}>
        {label}
      </span>
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function ConfigSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)" }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: "5px 0 16px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
      {children}
    </section>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function DisplayConfig() {
  const { mode, themeName, setMode, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [allThemes, setAllThemes] = useState<ThemeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/themes")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { themes: ThemeInfo[] } | null) => {
        if (cancelled || !data) return;
        setAllThemes(data.themes);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const effectiveTheme = themeName;

  const handleThemeChange = useCallback((name: string) => {
    setApplying(name);
    setTheme(name).finally(() => setApplying(null));
  }, [setTheme]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("display")}</h1>
      </header>

      <ConfigSection title={t("theme")} description={t("themeDescription")}>
        {/* Select the color palette first; its name and colors do not encode mode. */}
        <SectionLabel icon={<Check size={14} weight="bold" />} label="Color Theme" />
        {loading ? (
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading themes…</span>
          ) : (
            <div style={tagGroupStyle}>
              {/* Default option */}
              <button
                type="button"
                onClick={() => handleThemeChange("")}
                disabled={applying !== null}
                style={tagStyle(effectiveTheme === "", applying !== null)}
                onMouseEnter={(e) => {
                  if (effectiveTheme !== "") Object.assign(e.currentTarget.style, tagHoverStyle(false));
                }}
                onMouseLeave={(e) => {
                  if (effectiveTheme !== "") {
                    e.currentTarget.style.borderColor = "";
                    e.currentTarget.style.background = "";
                    e.currentTarget.style.color = "";
                  }
                }}
              >
                Default
              </button>

              {allThemes.map((tinfo) => (
                <button
                  key={tinfo.name}
                  type="button"
                  onClick={() => handleThemeChange(tinfo.name)}
                  disabled={applying !== null}
                  style={tagStyle(effectiveTheme === tinfo.name, applying === tinfo.name)}
                  onMouseEnter={(e) => {
                    if (effectiveTheme !== tinfo.name) Object.assign(e.currentTarget.style, tagHoverStyle(false));
                  }}
                  onMouseLeave={(e) => {
                    if (effectiveTheme !== tinfo.name) {
                      e.currentTarget.style.borderColor = "";
                      e.currentTarget.style.background = "";
                      e.currentTarget.style.color = "";
                    }
                  }}
                >
                  <span style={{
                    display: "inline-block",
                    width: 12,
                    height: 12,
                    borderRadius: 4,
                    background: effectiveTheme === tinfo.name ? "var(--accent)" : "var(--border)",
                    flexShrink: 0,
                    transition: "background 0.15s",
                  }} />
                  {tinfo.displayName}
                </button>
              ))}
            </div>
        )}

        <div style={{ marginTop: 20 }}>
          <SectionLabel icon={<Sun size={14} weight="fill" />} label="Color Mode" />
          <div style={tagGroupStyle}>
            {(["light", "dark"] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={tagStyle(active)}
                  onMouseEnter={(e) => {
                    if (!active) Object.assign(e.currentTarget.style, tagHoverStyle(active));
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.borderColor = "";
                      e.currentTarget.style.background = "";
                      e.currentTarget.style.color = "";
                    }
                  }}
                >
                  {m === "light" ? <Sun size={15} weight={active ? "fill" : "regular"} /> : <Moon size={15} weight={active ? "fill" : "regular"} />}
                  {m === "light" ? "Light" : "Dark"}
                </button>
              );
            })}
          </div>
        </div>
      </ConfigSection>

      {/* ── Language ── */}
      <ConfigSection title={t("language")} description={t("languageDescription")}>
        <div style={tagGroupStyle}>
          {(["en", "zh-CN"] as const).map((lang) => {
            const active = (lang === "zh-CN") ? language === "zh-CN" : language !== "zh-CN";
            return (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang === "zh-CN" ? "zh-CN" : "en")}
                style={tagStyle(active)}
                onMouseEnter={(e) => {
                  if (!active) Object.assign(e.currentTarget.style, tagHoverStyle(active));
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = "";
                    e.currentTarget.style.background = "";
                    e.currentTarget.style.color = "";
                  }
                }}
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
