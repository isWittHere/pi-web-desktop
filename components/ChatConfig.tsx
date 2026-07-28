"use client";

import { useState, useCallback, useEffect } from "react";
import { SettingSection, SettingToggle } from "./SettingToggle";
import { useLanguage } from "@/hooks/useLanguage";

export type InputShortcut = "enter" | "ctrl-enter";

const STORAGE_KEY = "pi-input-shortcut";

function getStoredShortcut(): InputShortcut {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "ctrl-enter" ? "ctrl-enter" : "enter";
  } catch {
    return "enter";
  }
}

export function ChatConfig() {
  const { t } = useLanguage();
  const [shortcut, setShortcut] = useState<InputShortcut>(getStoredShortcut);

  useEffect(() => {
    const handler = () => setShortcut(getStoredShortcut());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setShortcutAndPersist = useCallback((value: InputShortcut) => {
    setShortcut(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: value }));
    } catch {
      // Ignore storage errors.
    }
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("chat")}</h1>
      </header>
      <SettingSection title={t("inputShortcut")} description={t("inputShortcutDescription")}>
        <SettingToggle
          checked={shortcut === "ctrl-enter"}
          onChange={(checked) => setShortcutAndPersist(checked ? "ctrl-enter" : "enter")}
          label={t("useCtrlEnter")}
          description={t("useCtrlEnterDescription")}
        />
      </SettingSection>
    </div>
  );
}
