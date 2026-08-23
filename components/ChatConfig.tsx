"use client";

import { useState, useCallback, useEffect } from "react";
import { Toggle } from "./Toggle";
import { SettingsPage, SettingsGroup, SettingsRow, SettingsSelect, SettingsPageHeader } from "@/components/settings-ui";
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
const COMPACT_INPUT_KEY = "pi-compact-input";

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

function getStoredCompactInput(): boolean {
  try {
    return localStorage.getItem(COMPACT_INPUT_KEY) !== "off";
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
  const [compactInput, setCompactInput] = useState<boolean>(getStoredCompactInput);
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
      setCompactInput(getStoredCompactInput());
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

  const setCompactInputAndPersist = useCallback((checked: boolean) => {
    setCompactInput(checked);
    persistSetting(COMPACT_INPUT_KEY, checked ? "on" : "off");
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
    <SettingsPage>
      <SettingsPageHeader title={t("desktop.chat")} description={t("desktop.settingsPageChat")} />
      <SettingsGroup title={t("desktop.chatGroupSession")}>
        <SettingsRow
          label={t("desktop.titleAutoGenerate")}
          description={t("desktop.titleAutoGenerateDescription")}
          control={
            <Toggle
              checked={titleAuto}
              onChange={setTitleAutoAndPersist}
              label={t("desktop.titleAutoGenerate")}
            />
          }
        />
        <SettingsRow
          label={t("desktop.titleModel")}
          description={t("desktop.titleModelDescription")}
          control={
            <SettingsSelect
              value={selectedTitleModelValue}
              onChange={setTitleModelAndPersist}
              options={modelOptions.map((opt) => ({ value: `${opt.provider}:${opt.modelId}`, label: opt.label }))}
              emptyLabel={t("desktop.titleModelNone")}
              style={{ width: "min(300px, 100%)", maxWidth: 320 }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("desktop.chatGroupInput")}>
        <SettingsRow
          label={t("desktop.useCtrlEnter")}
          description={t("desktop.useCtrlEnterDescription")}
          control={
            <Toggle
              checked={shortcut === "ctrl-enter"}
              onChange={(checked) => setShortcutAndPersist(checked ? "ctrl-enter" : "enter")}
              label={t("desktop.useCtrlEnter")}
            />
          }
        />
        <SettingsRow
          label={t("desktop.markdownListContinueLabel")}
          description={t("desktop.markdownListContinueDescription")}
          control={
            <Toggle
              checked={markdownList}
              onChange={setMarkdownListAndPersist}
              label={t("desktop.markdownListContinueLabel")}
            />
          }
        />
        <SettingsRow
          label={t("desktop.compactInputWhileReadingLabel")}
          description={t("desktop.compactInputWhileReadingDescription")}
          control={
            <Toggle
              checked={compactInput}
              onChange={setCompactInputAndPersist}
              label={t("desktop.compactInputWhileReadingLabel")}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("desktop.chatGroupNotifications")}>
        <SettingsRow
          label={t("desktop.notificationDurationLabel")}
          description={t("desktop.notificationDurationDescription")}
          control={
            <SettingsSelect
              value={notificationDuration}
              onChange={(v) => setNotificationDurationAndPersist(v as NotificationDuration)}
              options={NOTIFICATION_DURATION_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }))}
              style={{ width: "min(200px, 100%)" }}
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}