"use client";

import type { ReactNode } from "react";
import { Check, Moon, Sun, Translate } from "@phosphor-icons/react";
import { useLanguage, type Language } from "@/hooks/useLanguage";
import { useTheme, type Theme } from "@/hooks/useTheme";

function ChoiceButton<T extends string>({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flex: "1 1 180px",
        minWidth: 0,
        padding: "11px 12px",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 7,
        background: active ? "var(--bg-selected)" : "var(--bg)",
        color: active ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer",
        textAlign: "left",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(event) => {
        if (!active) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        if (!active) event.currentTarget.style.background = "var(--bg)";
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {active && <Check size={16} weight="bold" color="var(--accent)" aria-hidden="true" />}
    </button>
  );
}

function SettingSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)" }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: "5px 0 14px", fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)" }}>{description}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{children}</div>
    </section>
  );
}

export function DisplayConfig() {
  const { theme, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("display")}</h1>
      </header>
      <SettingSection title={t("theme")} description={t("themeDescription")}>
        <ChoiceButton<Theme>
          active={theme === "light"}
          icon={<Sun size={18} aria-hidden="true" />}
          label={t("light")}
          onClick={() => setTheme("light")}
        />
        <ChoiceButton<Theme>
          active={theme === "dark"}
          icon={<Moon size={18} aria-hidden="true" />}
          label={t("dark")}
          onClick={() => setTheme("dark")}
        />
      </SettingSection>
      <SettingSection title={t("language")} description={t("languageDescription")}>
        <ChoiceButton<Language>
          active={language === "en"}
          icon={<Translate size={18} aria-hidden="true" />}
          label={t("english")}
          onClick={() => setLanguage("en")}
        />
        <ChoiceButton<Language>
          active={language === "zh-CN"}
          icon={<Translate size={18} aria-hidden="true" />}
          label={t("chinese")}
          onClick={() => setLanguage("zh-CN")}
        />
      </SettingSection>
    </div>
  );
}
