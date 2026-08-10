"use client";

import { useState, useCallback, useEffect } from "react";
import { SettingSection, SettingToggle } from "./SettingToggle";
import { useI18n } from "@/hooks/useI18n";

export type InputShortcut = "enter" | "ctrl-enter";

const STORAGE_KEY = "pi-input-shortcut";
const MARKDOWN_LIST_KEY = "pi-markdown-list-continue";

function getStoredShortcut(): InputShortcut {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "ctrl-enter" ? "ctrl-enter" : "enter";
  } catch {
    return "enter";
  }
}

function getStoredMarkdownList(): boolean {
  try {
    return localStorage.getItem(MARKDOWN_LIST_KEY) !== "off";
  } catch {
    return true;
  }
}

function broadcastStorageChange(key: string, value: string | null) {
  try {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  } catch {
    // Ignore storage errors.
  }
}

export function ChatConfig() {
  const { t } = useI18n();
  const [shortcut, setShortcut] = useState<InputShortcut>(getStoredShortcut);
  const [markdownList, setMarkdownList] = useState<boolean>(getStoredMarkdownList);

  useEffect(() => {
    const handler = () => setShortcut(getStoredShortcut());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    const handler = () => setMarkdownList(getStoredMarkdownList());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setShortcutAndPersist = useCallback((value: InputShortcut) => {
    setShortcut(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Ignore storage errors.
    }
    broadcastStorageChange(STORAGE_KEY, value);
  }, []);

  const setMarkdownListAndPersist = useCallback((checked: boolean) => {
    setMarkdownList(checked);
    try {
      localStorage.setItem(MARKDOWN_LIST_KEY, checked ? "on" : "off");
    } catch {
      // Ignore storage errors.
    }
    broadcastStorageChange(MARKDOWN_LIST_KEY, checked ? "on" : "off");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("desktop.chat")}</h1>
      </header>
      <SettingSection title={t("desktop.inputShortcut")} description={t("desktop.inputShortcutDescription")}>
        <SettingToggle
          checked={shortcut === "ctrl-enter"}
          onChange={(checked) => setShortcutAndPersist(checked ? "ctrl-enter" : "enter")}
          label={t("desktop.useCtrlEnter")}
          description={t("desktop.useCtrlEnterDescription")}
        />
      </SettingSection>
      <SettingSection title={t("desktop.markdownListContinue")} description={t("desktop.markdownListContinueDescription")}>
        <SettingToggle
          checked={markdownList}
          onChange={setMarkdownListAndPersist}
          label={t("desktop.markdownListContinueLabel")}
        />
      </SettingSection>
    </div>
  );
}
