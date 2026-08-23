"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowSquareOut, Check, Link, Monitor, Moon, Rows, SquaresFour, Sun } from "@phosphor-icons/react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, type ThemeMode } from "@/hooks/useTheme";
import { useViewMode, type ViewMode } from "@/hooks/useViewMode";
import { useWallpaper } from "@/hooks/useWallpaper";
import { resolveWallpaperUrl } from "@/lib/wallpaper";
import { SettingsPage, SettingsGroup, SettingsRow, SettingsButton, SegmentedControl } from "@/components/settings-ui";
import { Toggle } from "@/components/Toggle";
import { isRecommendedEnabled, setRecommendedEnabledStorage } from "@/components/WelcomeLobby";
import type { ThemeSetInfo } from "@/lib/theme";

// ── Tag / chip helpers (discrete value presets: themes, text size) ──────────

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

// ── Main ────────────────────────────────────────────────────────────────────

export function DisplayConfig() {
  const { mode, themeName, setMode, setTheme, borderDepth, setBorderDepth, fontScale, setFontScale } = useTheme();
  const { locale: language, setLocale: setLanguage, t } = useI18n();
  const { viewMode, setViewMode } = useViewMode();
  const [themeSets, setThemeSets] = useState<ThemeSetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);

  // Recommended-workspaces toggle (welcome lobby section 2). Default on;
  // read/written through the shared helpers so the lobby and settings agree.
  const [recommendedEnabled, setRecommendedEnabled] = useState(true);
  useEffect(() => {
    setRecommendedEnabled(isRecommendedEnabled());
  }, []);
  const handleRecommendedToggle = useCallback((checked: boolean) => {
    setRecommendedEnabled(checked);
    setRecommendedEnabledStorage(checked);
  }, []);

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

  const handleModeChange = useCallback((m: string) => {
    setMode(m as ThemeMode);
  }, [setMode]);

  const handleViewModeChange = useCallback((v: string) => {
    setViewMode(v as ViewMode);
  }, [setViewMode]);

  const handleLanguageChange = useCallback((lang: string) => {
    setLanguage(lang === "zh-CN" ? "zh-CN" : "en");
  }, [setLanguage]);

  // ── Wallpaper ──
  const { enabled: wallpaperEnabled, url: wallpaperUrl, scrim: wallpaperScrim, messageMode: wallpaperMessageMode, panelMode: wallpaperPanelMode, inputMode: wallpaperInputMode, busy: wallpaperBusy, error: wallpaperError, choose: chooseWallpaper, remove: removeWallpaper, setEnabled: setWallpaperEnabled, setScrim: setWallpaperScrim, setInputMode: setWallpaperInputMode, setMessageMode: setWallpaperMessageMode, setPanelMode: setWallpaperPanelMode } = useWallpaper();
  const wallpaperFileRef = useRef<HTMLInputElement>(null);

  const pickWallpaper = useCallback(() => {
    wallpaperFileRef.current?.click();
  }, []);

  const handleWallpaperFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void chooseWallpaper(file);
    // Allow re-picking the same file after a failed attempt.
    e.target.value = "";
  }, [chooseWallpaper]);

  const handleWallpaperRemove = useCallback(() => {
    removeWallpaper();
  }, [removeWallpaper]);

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

  const wallpaperEffects = [
    ["input", t("desktop.wallpaperBlurInput"), wallpaperInputMode, setWallpaperInputMode],
    ["message", t("desktop.wallpaperBlurMessage"), wallpaperMessageMode, setWallpaperMessageMode],
    ["panel", t("desktop.wallpaperBlurPanel"), wallpaperPanelMode, setWallpaperPanelMode],
  ] as const;

  return (
    <SettingsPage>
      {/* ── Theme & color ── */}
      <SettingsGroup title={t("desktop.displayGroupTheme")}>
        <SettingsRow
          label={t("desktop.theme")}
          control={
            <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
              <button
                type="button"
                onClick={openThemeFolder}
                style={textActionButtonStyle}
                {...underlineOnHover}
              >
                <ArrowSquareOut size={12} weight="regular" aria-hidden="true" />
                {t("desktop.openThemeFolder")}
              </button>
              <button
                type="button"
                onClick={openThemeDocs}
                style={textActionButtonStyle}
                {...underlineOnHover}
              >
                <Link size={12} weight="regular" aria-hidden="true" />
                {t("desktop.learnPiThemes")}
              </button>
            </div>
          }
        />

        {/* Theme options live on their own line below the title row. */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            padding: "0 12px 10px",
            margin: "-6px -12px 0",
          }}
        >
          {loading ? (
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("desktop.loadingThemes")}</span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleThemeChange("")}
                disabled={applying !== null}
                style={tagStyle(themeName === "", hoveredTag === "__default__", applying !== null)}
                onMouseEnter={() => setHoveredTag("__default__")}
                onMouseLeave={() => setHoveredTag(null)}
              >
                {t("desktop.defaultTheme")}
              </button>
              {themeSets.map((ts) => (
                <button
                  key={ts.name}
                  type="button"
                  onClick={() => handleThemeChange(ts.name)}
                  disabled={applying !== null}
                  style={tagStyle(themeName === ts.name, hoveredTag === ts.name, applying === ts.name)}
                  onMouseEnter={() => setHoveredTag(ts.name)}
                  onMouseLeave={() => setHoveredTag(null)}
                >
                  {ts.displayName}
                </button>
              ))}
            </>
          )}
        </div>

        <SettingsRow
          label={t("desktop.appearanceMode")}
          control={
            <SegmentedControl
              value={mode}
              onChange={handleModeChange}
              ariaLabel={t("desktop.appearanceMode")}
              options={[
                { value: "light", label: t("desktop.light"), icon: <Sun size={14} weight="fill" /> },
                { value: "dark", label: t("desktop.dark"), icon: <Moon size={14} weight="fill" /> },
                { value: "system", label: t("desktop.system"), icon: <Monitor size={14} weight="fill" /> },
              ]}
            />
          }
        />

        <SettingsRow
          label={`${t("desktop.borderVisibility")} (${borderDepth})`}
          control={
            <div style={{ display: "flex", gap: 10 }}>
              {[25, 50, 75, 100].map((d) => {
                const active = borderDepth === d;
                const previewBorder = d <= 50
                  ? `color-mix(in srgb, var(--border-orig) ${d * 2}%, var(--bg) ${100 - d * 2}%)`
                  : `color-mix(in srgb, var(--border-orig) ${100 - (d - 50) * 2}%, var(--text) ${(d - 50) * 2}%)`;
                return (
                  <div
                    key={d}
                    role="radio"
                    aria-checked={active}
                    aria-label={`${t("desktop.borderVisibility")} ${d}`}
                    onClick={() => setBorderDepth(d)}
                    style={{
                      width: 28, height: 20,
                      border: `2px solid ${previewBorder}`,
                      borderRadius: 5,
                      background: "var(--bg-card)",
                      cursor: "pointer",
                      transition: "border-color 0.1s",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {active && <Check size={13} weight="bold" color="var(--accent)" aria-hidden="true" />}
                  </div>
                );
              })}
            </div>
          }
        />
      </SettingsGroup>

      {/* ── Interface ── */}
      <SettingsGroup title={t("desktop.displayGroupInterface")}>
        <SettingsRow
          label={t("desktop.textSize")}
          description={t("desktop.textSizeDescription")}
          control={
            <div style={{ ...tagGroupStyle, justifyContent: "flex-end" }}>
              {[0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.35].map((s) => {
                const active = fontScale === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFontScale(s)}
                    style={tagStyle(active, hoveredTag === `scale:${s}`)}
                    onMouseEnter={() => setHoveredTag(`scale:${s}`)}
                    onMouseLeave={() => setHoveredTag(null)}
                  >
                    {Math.round(s * 100)}%
                  </button>
                );
              })}
            </div>
          }
        />

        <SettingsRow
          label={t("desktop.viewMode")}
          description={t("desktop.viewModeDescription")}
          control={
            <SegmentedControl
              value={viewMode}
              onChange={handleViewModeChange}
              ariaLabel={t("desktop.viewMode")}
              options={[
                { value: "classic", label: t("desktop.viewModeClassic"), icon: <Rows size={14} weight="fill" /> },
                { value: "tabs", label: t("desktop.viewModeTabs"), icon: <SquaresFour size={14} weight="fill" /> },
              ]}
            />
          }
        />

        <SettingsRow
          label={t("desktop.language")}
          description={t("desktop.languageDescription")}
          control={
            <SegmentedControl
              value={language === "zh-CN" ? "zh-CN" : "en"}
              onChange={handleLanguageChange}
              ariaLabel={t("desktop.language")}
              options={[
                { value: "en", label: t("desktop.english") },
                { value: "zh-CN", label: t("desktop.chinese") },
              ]}
            />
          }
        />

        <SettingsRow
          label={t("desktop.recommendedWorkspaces")}
          control={
            <Toggle
              checked={recommendedEnabled}
              onChange={handleRecommendedToggle}
              label={t("desktop.recommendedWorkspaces")}
            />
          }
        />
      </SettingsGroup>

      {/* ── Background ── */}
      <SettingsGroup title={t("desktop.displayGroupBackground")}>
        <SettingsRow
          label={t("desktop.wallpaperEnable")}
          control={
            <Toggle
              checked={wallpaperEnabled}
              onChange={setWallpaperEnabled}
              label={t("desktop.wallpaperEnable")}
            />
          }
        />

        {wallpaperEnabled && (
          <>
            <SettingsRow
              label={t("desktop.wallpaperImage")}
              description={t("desktop.wallpaperImageDescription")}
              control={
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <SettingsButton size="sm" onClick={pickWallpaper} disabled={wallpaperBusy}>
                    {wallpaperBusy ? t("desktop.wallpaperUploading") : t("desktop.wallpaperChoose")}
                  </SettingsButton>
                  {wallpaperUrl && (
                    <SettingsButton size="sm" onClick={handleWallpaperRemove}>
                      {t("desktop.wallpaperResetDefault")}
                    </SettingsButton>
                  )}
                </div>
              }
            />

            {/* Live preview: the user image or the theme painting under the
                current scrim opacity. */}
            <div style={{ padding: "8px 12px 0", margin: "0 -12px" }}>
              <div
                style={{
                  position: "relative",
                  height: 64,
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  overflow: "hidden",
                  backgroundColor: "var(--bg-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL / static asset, not optimizer-routable */}
                <img
                  src={resolveWallpaperUrl(wallpaperUrl, themeName)}
                  alt=""
                  draggable={false}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }}
                />
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    // Scrim overlay — same color-mix the real layer uses.
                    background: `color-mix(in srgb, var(--bg) ${wallpaperScrim}%, transparent)`,
                  }}
                />
              </div>
            </div>

            <SettingsRow
              label={`${t("desktop.wallpaperOpacity")} (${wallpaperScrim}%)`}
              control={
                <input
                  type="range"
                  min={30}
                  max={95}
                  step={5}
                  value={wallpaperScrim}
                  onChange={(e) => setWallpaperScrim(parseInt(e.target.value, 10))}
                  style={{ width: 220, maxWidth: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
                  aria-label={t("desktop.wallpaperOpacity")}
                />
              }
            />

            {wallpaperEffects.map(([id, label, mode, setter]) => (
              <SettingsRow
                key={id}
                label={label}
                control={
                  <SegmentedControl
                    size="sm"
                    value={mode}
                    onChange={(value) => setter(value as "none" | "trans" | "blur")}
                    ariaLabel={label}
                    options={[
                      { value: "none", label: t("desktop.wallpaperModeNone") },
                      { value: "trans", label: t("desktop.wallpaperModeTrans") },
                      { value: "blur", label: t("desktop.wallpaperModeBlur") },
                    ]}
                  />
                }
              />
            ))}
          </>
        )}

        {wallpaperError && (
          <p style={{ margin: "8px 12px 0", fontSize: 11, color: "var(--status-danger)", lineHeight: 1.5 }}>
            {t("desktop.wallpaperError")}: {wallpaperError}
          </p>
        )}
      </SettingsGroup>

      {/* Hidden file input, shared by both pick entries. */}
      <input
        ref={wallpaperFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={handleWallpaperFile}
      />
    </SettingsPage>
  );
}