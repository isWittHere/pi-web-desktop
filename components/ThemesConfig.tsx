"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut, Check } from "@phosphor-icons/react";
import { SettingsBadge, SettingsButton, SettingsPane } from "@/components/settings-ui";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import type { ThemeSetInfo } from "@/lib/theme";
export function ThemesConfig({ cwd }: { cwd: string }) {
  const { t } = useI18n();
  const { themeName, setTheme } = useTheme();
  const [themeSets, setThemeSets] = useState<ThemeSetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/themes?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { themeSets?: ThemeSetInfo[] } | null) => {
        if (cancelled || !data) return;
        setThemeSets(data.themeSets ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const applyTheme = (name: string) => {
    setApplying(name);
    setTheme(name).finally(() => setApplying(null));
  };

  const allSets = [{ name: "", displayName: t("desktop.defaultTheme"), hasDark: true, hasLight: true, builtin: true }, ...themeSets];
  const activeName = themeName ?? "";
  const activeSet = allSets.find((set) => set.name === activeName) ?? allSets[0];

  return (
    <SettingsPane
      sidebar={
        <div style={{ padding: "8px 6px" }}>
          {loading ? (
            <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.loadingThemes")}</div>
          ) : (
            allSets.map((set) => {
              const isActive = set.name === activeName;
              const busy = applying === set.name;
              return (
                <div
                  key={set.name}
                  onClick={() => {
                    if (!busy && !isActive) applyTheme(set.name);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 8px",
                    borderRadius: 5,
                    cursor: busy ? "wait" : "pointer",
                    background: isActive ? "var(--bg-selected)" : "none",
                    opacity: busy ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "none";
                  }}
                >
                  {isActive ? (
                    <Check size={13} weight="bold" color="var(--accent)" style={{ flexShrink: 0 }} aria-hidden="true" />
                  ) : (
                    <span style={{ width: 13, flexShrink: 0 }} aria-hidden="true" />
                  )}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      color: "var(--text)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {set.displayName}
                  </span>
                  {set.builtin && (
                    <SettingsBadge tone="muted">{t("desktop.themeSourceBuiltin")}</SettingsBadge>
                  )}
                </div>
              );
            })
          )}
        </div>
      }
    >
      <div style={{ padding: 20, minHeight: "100%", boxSizing: "border-box" }}>
        {activeSet ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{activeSet.displayName}</span>
              {activeSet.builtin && <SettingsBadge tone="muted">{t("desktop.themeSourceBuiltin")}</SettingsBadge>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(96px, 130px) minmax(0, 1fr)", gap: "9px 14px", fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ color: "var(--text-dim)" }}>{t("desktop.themes")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {activeSet.hasDark && <SettingsBadge tone="muted">{t("desktop.darkVariant")}</SettingsBadge>}
                {activeSet.hasLight && <SettingsBadge tone="muted">{t("desktop.lightVariant")}</SettingsBadge>}
                {!activeSet.hasDark && !activeSet.hasLight && <span style={{ color: "var(--text-dim)" }}>—</span>}
              </div>
              <div style={{ color: "var(--text-dim)" }}>{t("desktop.status")}</div>
              <div style={{ color: "var(--accent)" }}>
                {activeSet.name === activeName ? t("desktop.applied") : t("desktop.available")}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SettingsButton
                variant="primary"
                onClick={() => applyTheme(activeSet.name)}
                disabled={applying !== null || activeSet.name === activeName}
              >
                {applying === activeSet.name ? t("desktop.loadingThemes") : t("desktop.apply")}
              </SettingsButton>
              <SettingsButton onClick={() => window.piDesktop?.openThemeFolder()}>
                <ArrowSquareOut size={12} aria-hidden="true" />
                {t("desktop.openThemeFolder")}
              </SettingsButton>
            </div>

            {themeSets.length === 0 && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {t("desktop.noCustomThemes")}{" "}
                {t("desktop.noCustomThemesHint")}{" "}
                <code style={{ fontSize: 10, background: "var(--bg-secondary)", padding: "1px 5px", borderRadius: 3, fontFamily: "var(--font-mono)" }}>~/.pi/agent/themes/*.json</code>{" "}
                {t("desktop.noCustomThemesHint2")}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </SettingsPane>
  );
}