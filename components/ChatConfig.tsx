"use client";

import { useState, useCallback, useEffect } from "react";
import { SettingSection, SettingToggle } from "./SettingToggle";
import { useI18n } from "@/hooks/useI18n";
import {
  getTitleAutoEnabled,
  getTitleModel,
  setTitleAutoEnabled,
  setTitleModel,
  clearTitleModel,
} from "@/lib/title-settings";

export type InputShortcut = "enter" | "ctrl-enter";

export type NotificationDuration = "60" | "180" | "300" | "forever";

export const NOTIFICATION_DURATION_KEY = "pi-notification-duration";

export const NOTIFICATION_DURATION_OPTIONS: { value: NotificationDuration; labelKey: string }[] = [
  { value: "60", labelKey: "desktop.notificationDuration1m" },
  { value: "180", labelKey: "desktop.notificationDuration3m" },
  { value: "300", labelKey: "desktop.notificationDuration5m" },
  { value: "forever", labelKey: "desktop.notificationDurationForever" },
];

function isNotificationDuration(value: string | null): value is NotificationDuration {
  return !!value && NOTIFICATION_DURATION_OPTIONS.some((opt) => opt.value === value);
}

export function getStoredNotificationDuration(): NotificationDuration {
  try {
    const stored = localStorage.getItem(NOTIFICATION_DURATION_KEY);
    return isNotificationDuration(stored) ? stored : "60"; // default 1 minute
  } catch {
    return "60";
  }
}

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

function persistSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    // Broadcast so other windows/panels (and the chat input) pick it up.
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  } catch {
    // Ignore storage errors.
  }
}

interface ModelOption {
  provider: string;
  modelId: string;
  label: string;
}

export function ChatConfig({ cwd }: { cwd?: string | null }) {
  const { t } = useI18n();
  const [shortcut, setShortcut] = useState<InputShortcut>(getStoredShortcut);
  const [markdownList, setMarkdownList] = useState<boolean>(getStoredMarkdownList);
  const [notificationDuration, setNotificationDuration] = useState<NotificationDuration>(getStoredNotificationDuration);
  const [titleAuto, setTitleAuto] = useState<boolean>(getTitleAutoEnabled);
  const [titleModel, setTitleModelState] = useState<{ provider: string; modelId: string } | null>(getTitleModel);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  // Load the configured/visible model list for the title-model picker.
  useEffect(() => {
    const url = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { modelList?: { id: string; name: string; provider: string }[] } | null) => {
        const list = data?.modelList ?? [];
        setModelOptions(
          list
            .filter((m) => m.id && m.provider)
            .map((m) => ({
              provider: m.provider,
              modelId: m.id,
              label: `${m.name || m.id} · ${m.provider}`,
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      })
      .catch(() => {
        setModelOptions([]);
      });
  }, [cwd]);

  useEffect(() => {
    const handler = () => {
      setShortcut(getStoredShortcut());
      setMarkdownList(getStoredMarkdownList());
      setNotificationDuration(getStoredNotificationDuration());
      setTitleAuto(getTitleAutoEnabled());
      setTitleModelState(getTitleModel());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setShortcutAndPersist = useCallback((value: InputShortcut) => {
    setShortcut(value);
    persistSetting(STORAGE_KEY, value);
  }, []);

  const setMarkdownListAndPersist = useCallback((checked: boolean) => {
    setMarkdownList(checked);
    persistSetting(MARKDOWN_LIST_KEY, checked ? "on" : "off");
  }, []);

  const setNotificationDurationAndPersist = useCallback((value: NotificationDuration) => {
    setNotificationDuration(value);
    persistSetting(NOTIFICATION_DURATION_KEY, value);
  }, []);

  const setTitleAutoAndPersist = useCallback((checked: boolean) => {
    setTitleAuto(checked);
    setTitleAutoEnabled(checked);
  }, []);

  const setTitleModelAndPersist = useCallback((value: string) => {
    if (!value) {
      clearTitleModel();
      setTitleModelState(null);
      return;
    }
    const sep = value.indexOf(":");
    const provider = value.slice(0, sep);
    const modelId = value.slice(sep + 1);
    setTitleModel(provider, modelId);
    setTitleModelState({ provider, modelId });
  }, []);

  const selectedTitleModelValue = titleModel
    ? `${titleModel.provider}:${titleModel.modelId}`
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <header style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("desktop.chat")}</h1>
      </header>
      <SettingSection title={t("desktop.sessionTitle")} description={t("desktop.sessionTitleDescription")}>
        <SettingToggle
          checked={titleAuto}
          onChange={setTitleAutoAndPersist}
          label={t("desktop.titleAutoGenerate")}
          description={t("desktop.titleAutoGenerateDescription")}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", margin: "0 -14px" }}>
          <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{t("desktop.titleModel")}</span>
          <select
            value={selectedTitleModelValue}
            onChange={(e) => setTitleModelAndPersist(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
              outline: "none",
              maxWidth: 260,
            }}
          >
            <option value="">{t("desktop.titleModelNone")}</option>
            {modelOptions.map((opt) => (
              <option key={`${opt.provider}:${opt.modelId}`} value={`${opt.provider}:${opt.modelId}`}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </SettingSection>
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
      <SettingSection title={t("desktop.notificationDuration")} description={t("desktop.notificationDurationDescription")}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", margin: "0 -14px" }}>
          <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{t("desktop.notificationDurationLabel")}</span>
          <select
            value={notificationDuration}
            onChange={(e) => setNotificationDurationAndPersist(e.target.value as NotificationDuration)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {NOTIFICATION_DURATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
            ))}
          </select>
        </div>
      </SettingSection>
    </div>
  );
}
