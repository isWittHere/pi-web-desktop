"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SubagentProfilesResponse, SubagentSettingsResponse } from "@/lib/api-types";
import type { ModelsData } from "@/lib/models-cache";
import { isSubagentProfileOverridden } from "@/lib/subagent-profile-precedence";
import type { SubagentProfile, SubagentScope, SubagentWritableScope } from "@/lib/subagents";
import { sendAgentCommand } from "@/lib/agent-client";
import { Toggle } from "./Toggle";
import {
  SettingsBadge,
  SettingsButton,
  SettingsChipGroup,
  SettingsField,
  SettingsInput,
  SettingsNumInput,
  SettingsPane,
  SettingsSelect,
  settingsSidebarFooterStyle,
  sidebarGroupStyle,
} from "./settings-ui";

const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type EditableProfile = Omit<SubagentProfile, "scope" | "filePath">;
type EditorMode = "view" | "edit" | "create";

const EMPTY_PROFILE: EditableProfile = {
  name: "custom-agent",
  displayName: "Custom agent",
  description: "",
  systemPrompt: "",
  tools: [...TOOL_OPTIONS],
  loadSkills: false,
  loadExtensions: false,
  promptMode: "append",
  inheritContext: false,
  runInBackground: false,
  enabled: true,
};

function editableProfile(profile: SubagentProfile): EditableProfile {
  return {
    name: profile.name,
    displayName: profile.displayName,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    tools: [...profile.tools],
    loadSkills: profile.loadSkills,
    loadExtensions: profile.loadExtensions,
    promptMode: profile.promptMode,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    ...(profile.maxTurns ? { maxTurns: profile.maxTurns } : {}),
    inheritContext: profile.inheritContext,
    runInBackground: profile.runInBackground,
    enabled: profile.enabled,
  };
}

function profileKey(profile: Pick<SubagentProfile, "scope" | "name">): string {
  return `${profile.scope}:${profile.name}`;
}

function duplicateProfileName(name: string, profiles: readonly SubagentProfile[]): string {
  const existing = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  const base = `${name}-copy`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) candidate = `${base}-${suffix++}`;
  return candidate;
}

function isWritableScope(scope: SubagentScope): scope is SubagentWritableScope {
  return scope === "global" || scope === "project";
}

function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}

function displayProfilePath(profile: SubagentProfile, cwd: string): string | null {
  if (!profile.filePath) return null;
  if ((profile.scope === "project" || profile.scope === "workspace") && profile.filePath.startsWith(cwd)) {
    const relative = profile.filePath.slice(cwd.length).replace(/^[/\\]/, "");
    return `./${relative}`;
  }
  return shortenPath(profile.filePath);
}

const detailGridStyle: CSSProperties = { display: "grid", gap: 14 };
const labelValueGrid: CSSProperties = { display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: "8px 12px", alignItems: "start" };

export function AgentsConfig({
  cwd,
  sessionId,
  onReloadedAction,
}: {
  cwd: string;
  sessionId: string | null;
  onReloadedAction?: () => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelsData["modelList"]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableProfile>(EMPTY_PROFILE);
  const [mode, setMode] = useState<EditorMode>("view");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [targetScope, setTargetScope] = useState<SubagentWritableScope>("global");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [builtInEnabled, setBuiltInEnabled] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [reloading, setReloading] = useState(false);

  const selected = useMemo(
    () => profiles.find((profile) => profileKey(profile) === selectedKey) ?? null,
    [profiles, selectedKey],
  );

  const loadProfiles = useCallback(async (preferredKey?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await response.json() as Partial<SubagentProfilesResponse> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const next = data.profiles ?? [];
      setProfiles(next);
      const rememberedKey = preferredKey ?? selectedKey;
      const chosen = next.find((profile) => profileKey(profile) === rememberedKey)
        ?? next.find((profile) => profile.scope === "project")
        ?? next.find((profile) => profile.scope === "global")
        ?? next[0]
        ?? null;
      setSelectedKey(chosen ? profileKey(chosen) : null);
      if (chosen) {
        setDraft(editableProfile(chosen));
        setMode(isWritableScope(chosen.scope) ? "edit" : "view");
        if (isWritableScope(chosen.scope)) setTargetScope(chosen.scope);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
    // selectedKey intentionally omitted: only the initial load should fall back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    const controller = new AbortController();
    setSettingsLoading(true);
    setSettingsError(null);
    void (async () => {
      try {
        const response = await fetch("/api/subagents/settings", { cache: "no-store", signal: controller.signal });
        const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
        if (!response.ok || data.error || typeof data.enabled !== "boolean") {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setBuiltInEnabled(data.enabled);
        if (typeof data.maxConcurrent === "number") setMaxConcurrent(data.maxConcurrent);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setSettingsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setSettingsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/models?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal });
        const data = await response.json() as Partial<ModelsData> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setModelOptions(data.modelList ?? []);
        setModelsError(data.modelError ?? null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => controller.abort();
  }, [cwd]);

  const selectProfile = (profile: SubagentProfile) => {
    setSelectedKey(profileKey(profile));
    setDraft(editableProfile(profile));
    setMode(isWritableScope(profile.scope) ? "edit" : "view");
    if (isWritableScope(profile.scope)) setTargetScope(profile.scope);
    setError(null);
  };

  const beginCreate = () => {
    let name = "custom-agent";
    let suffix = 2;
    while (profiles.some((profile) => profile.name === name)) name = `custom-agent-${suffix++}`;
    setSelectedKey(null);
    setDraft({ ...EMPTY_PROFILE, name, displayName: name });
    setMode("create");
    setTargetScope("global");
    setError(null);
  };

  const beginDuplicate = () => {
    if (!selected) return;
    const name = duplicateProfileName(selected.name, profiles);
    setSelectedKey(null);
    setDraft({
      ...editableProfile(selected),
      name,
      displayName: t("agents.copyName", { name: selected.displayName }),
    });
    setMode("create");
    setTargetScope(isWritableScope(selected.scope) ? selected.scope : "global");
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: targetScope, profile: draft }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles(profileKey(data.profile));
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !isWritableScope(selected.scope)) return;
    if (!window.confirm(t("agents.deleteConfirm", { name: selected.displayName }))) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const editing = mode !== "view";
  const creating = mode === "create";
  const disabled = !editing || saving || toggling;
  const displayedScope = creating ? targetScope : selected?.scope;
  const displayedPath = creating
    ? targetScope === "global"
      ? `~/.pi/agent/agents/${draft.name || "..."}.md`
      : `./.pi/agents/${draft.name || "..."}.md`
    : selected
      ? displayProfilePath(selected, cwd) ?? t("agents.builtinPath")
      : "";
  const update = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (creating) {
      update("enabled", enabled);
      return;
    }
    if (!selected || !isWritableScope(selected.scope)) return;
    setToggling(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name, enabled }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      const saved = data.profile;
      setProfiles((current) => current.map((profile) => profileKey(profile) === profileKey(saved) ? saved : profile));
      setDraft((current) => ({ ...current, enabled: saved.enabled }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setToggling(false);
    }
  };

  const toggleBuiltInSubagents = async (enabled: boolean) => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.enabled !== "boolean") {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setBuiltInEnabled(data.enabled);
      setReloadNeeded(Boolean(sessionId));
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateMaxConcurrent = async (value: number) => {
    setMaxConcurrent(value);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrent: value }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.maxConcurrent !== "number") {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setMaxConcurrent(data.maxConcurrent);
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const reloadSession = async () => {
    if (!sessionId) return;
    setReloading(true);
    setSettingsError(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      setReloadNeeded(false);
      onReloadedAction?.();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReloading(false);
    }
  };

  // The select needs an entry for a saved model the current runtime no longer
  // offers, so the raw value still displays instead of silently resetting.
  const modelSelectOptions = useMemo(() => {
    const options = modelOptions.map((model) => ({ value: `${model.provider}/${model.id}`, label: `${model.provider}/${model.id}` }));
    if (draft.model && !options.some((option) => option.value === draft.model)) {
      options.push({ value: draft.model, label: t("agents.modelUnavailable", { model: draft.model }) });
    }
    return options;
  }, [modelOptions, draft.model, t]);

  const scopedGroupOrder = ["project", "global", "workspace"] as const;

  const renderProfileRow = (profile: SubagentProfile) => {
    const overridden = isSubagentProfileOverridden(profile, profiles);
    const isSelected = selectedKey === profileKey(profile) && !creating;
    return (
      <div
        key={profileKey(profile)}
        role="button"
        tabIndex={0}
        onClick={() => selectProfile(profile)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectProfile(profile);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 8px",
          borderRadius: 5,
          cursor: "pointer",
          background: isSelected ? "var(--bg-selected)" : "none",
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isSelected ? "var(--bg-selected)" : "none";
        }}
      >
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: profile.enabled ? "var(--status-success)" : "var(--text-dim)",
          }}
        />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: isSelected ? 600 : 400,
            color: profile.enabled ? "var(--text)" : "var(--text-dim)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {profile.displayName}
        </span>
        {overridden && <SettingsBadge tone="muted">{t("agents.overridden")}</SettingsBadge>}
      </div>
    );
  };

  return (
    <SettingsPane
      sidebar={
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 6px" }}>
            {loading && <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("agents.loading")}</div>}
            {/* The built-in group owns the master switch, so it always renders. */}
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...sidebarGroupStyle, paddingBottom: 0 }}>{t("agents.scope.builtin")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 8px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text)" }}>{t("agents.builtInTitle")}</span>
                  <Toggle
                    checked={builtInEnabled}
                    disabled={settingsLoading || reloading}
                    loading={settingsSaving}
                    label={t("agents.builtInTitle")}
                    onChange={(enabled) => void toggleBuiltInSubagents(enabled)}
                  />
                </div>
                <span style={{ fontSize: 11, lineHeight: 1.45, color: "var(--text-muted)" }}>{t("agents.builtInDescription")}</span>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("agents.maxConcurrent")}</span>
                  <input
                    aria-label={t("agents.maxConcurrent")}
                    type="number"
                    min={1}
                    max={32}
                    value={maxConcurrent}
                    disabled={settingsLoading || settingsSaving}
                    onChange={(event) => setMaxConcurrent(Number(event.target.value))}
                    onBlur={() => void updateMaxConcurrent(maxConcurrent)}
                    style={{ width: 64, background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "2px 6px", fontSize: 12 }}
                  />
                </div>
                <div style={{ fontSize: 10, lineHeight: 1.4, color: "var(--text-dim)" }}>{t("agents.maxConcurrentDescription")}</div>
                {reloadNeeded && sessionId && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--status-warning)" }}>{t("agents.reloadRequired")}</span>
                    <SettingsButton size="sm" onClick={() => void reloadSession()} disabled={reloading || settingsSaving}>
                      {reloading ? t("agents.reloading") : t("agents.reloadSession")}
                    </SettingsButton>
                  </div>
                )}
              </div>
              {!loading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {profiles.filter((profile) => profile.scope === "builtin").map(renderProfileRow)}
                </div>
              )}
            </div>
            {!loading && scopedGroupOrder.map((scope) => {
              const scopedProfiles = profiles.filter((profile) => profile.scope === scope);
              if (scopedProfiles.length === 0) return null;
              return (
                <div key={scope} style={{ marginBottom: 6 }}>
                  <div style={sidebarGroupStyle}>{t(`agents.scope.${scope}`)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {scopedProfiles.map(renderProfileRow)}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={settingsSidebarFooterStyle}>
            <button
              type="button"
              onClick={beginCreate}
              disabled={loading}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 8px",
                borderRadius: 5,
                border: "none",
                width: "100%",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
                background: creating ? "var(--bg-selected)" : "none",
                color: creating ? "var(--accent)" : "var(--text-dim)",
                fontSize: 12,
              }}
              onMouseEnter={(e) => {
                if (!creating && !loading) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = creating ? "var(--bg-selected)" : "none";
              }}
            >
              <PlusIcon size={13} />
              {t("agents.new")}
            </button>
          </div>
        </div>
      }
      footer={
        editing ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "10px 14px" }}>
            {(settingsError || error) && (
              <span role="alert" style={{ marginRight: "auto", fontSize: 12, color: "var(--status-danger)", overflowWrap: "anywhere" }}>
                {settingsError || error}
              </span>
            )}
            <SettingsButton
              variant="primary"
              onClick={() => void save()}
              disabled={saving || savedOk || toggling || !draft.name.trim()}
            >
              {savedOk ? t("desktop.modelsSaved") : saving ? t("agents.saving") : t("agents.save")}
            </SettingsButton>
          </div>
        ) : (settingsError || error) ? (
          <div style={{ padding: "10px 14px" }}>
            <span role="alert" style={{ fontSize: 12, color: "var(--status-danger)" }}>{settingsError || error}</span>
          </div>
        ) : undefined
      }
    >
      {!selected && !creating ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-dim)", fontSize: 13 }}>
          {loading ? t("agents.loading") : t("agents.empty")}
        </div>
      ) : (
        <div style={{ padding: "var(--settings-section-gap) var(--settings-pad-x)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {displayedScope && (
                <SettingsBadge tone={displayedScope === "project" ? "project" : "muted"}>
                  {t(`agents.scope.${displayedScope}`)}
                </SettingsBadge>
              )}
              <span title={selected?.filePath ?? displayedPath} style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayedPath}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {selected && (mode === "view" || mode === "edit") && (
                <SettingsButton size="sm" onClick={beginDuplicate} disabled={saving || toggling}>{t("agents.duplicate")}</SettingsButton>
              )}
              {selected && isWritableScope(selected.scope) && mode === "edit" && (
                <SettingsButton variant="danger" size="sm" onClick={() => void remove()} disabled={saving || toggling}>{t("agents.delete")}</SettingsButton>
              )}
              <Toggle
                checked={draft.enabled}
                disabled={disabled}
                label={draft.enabled ? t("agents.disable") : t("agents.enable")}
                onChange={(checked) => void toggleEnabled(checked)}
              />
            </div>
          </div>

          {creating && (
            <SettingsField label={t("agents.saveScope")}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, padding: 3, border: "1px solid var(--border)", borderRadius: "var(--control-radius)", background: "var(--bg-panel)" }}>
                {(["global", "project"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setTargetScope(scope)}
                    disabled={saving}
                    style={{
                      height: 26,
                      border: "none",
                      borderRadius: "calc(var(--control-radius) - 2px)",
                      background: targetScope === scope ? "var(--control-option-active-bg)" : "transparent",
                      color: targetScope === scope ? "var(--control-option-active-text)" : "var(--text-muted)",
                      cursor: saving ? "default" : "pointer",
                      fontSize: 11,
                      fontWeight: targetScope === scope ? 600 : 400,
                    }}
                  >
                    {t(`agents.scope.${scope}`)}
                  </button>
                ))}
              </div>
            </SettingsField>
          )}

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
            <SettingsField label={t("agents.name")}>
              {creating ? (
                <SettingsInput value={draft.name} onChange={(value) => update("name", value)} disabled={disabled} mono />
              ) : (
                <div style={{ height: "var(--control-height)", display: "flex", alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {draft.name}
                </div>
              )}
            </SettingsField>
            <SettingsField label={t("agents.displayName")}>
              <SettingsInput value={draft.displayName} onChange={(value) => update("displayName", value)} />
            </SettingsField>
          </div>
          <SettingsField label={t("agents.description")}>
            <SettingsInput value={draft.description} onChange={(value) => update("description", value)} />
          </SettingsField>
          <SettingsField label={t("agents.prompt")}>
            <textarea
              aria-label={t("agents.prompt")}
              value={draft.systemPrompt}
              disabled={disabled}
              onChange={(event) => update("systemPrompt", event.target.value)}
              style={{
                minHeight: 180,
                maxHeight: "60vh",
                padding: 9,
                border: "1px solid var(--border)",
                borderRadius: "var(--control-radius)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: "var(--font-mono)",
                outline: "none",
                resize: "vertical",
                overflow: "auto",
                boxSizing: "border-box",
                width: "100%",
                opacity: disabled ? 0.55 : 1,
              }}
            />
          </SettingsField>

          <SettingsField label={t("agents.tools")}>
            <SettingsChipGroup
              label={t("agents.tools")}
              mono
              disabled={disabled}
              options={TOOL_OPTIONS.map((tool) => ({ value: tool, label: tool }))}
              selected={draft.tools}
              onToggle={(tool, checked) => update("tools", checked ? [...draft.tools, tool] : draft.tools.filter((item) => item !== tool))}
            />
          </SettingsField>

          <SettingsField label={t("agents.resources")}>
            <SettingsChipGroup
              label={t("agents.resources")}
              disabled={disabled}
              options={[
                { value: "loadSkills", label: t("agents.loadSkills") },
                { value: "loadExtensions", label: t("agents.loadExtensions") },
              ]}
              selected={[
                ...(draft.loadSkills ? ["loadSkills"] : []),
                ...(draft.loadExtensions ? ["loadExtensions"] : []),
              ]}
              onToggle={(value, checked) => update(value as "loadSkills" | "loadExtensions", checked)}
            />
          </SettingsField>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.5fr) minmax(120px, 0.75fr) minmax(100px, 0.5fr)", gap: 14 }}>
            <SettingsField label={t("agents.model")}>
              <SettingsSelect
                value={draft.model ?? ""}
                onChange={(value) => update("model", value || undefined)}
                options={modelSelectOptions}
                emptyLabel={modelOptions.length === 0 ? t("agents.modelsLoading") : t("agents.inherit")}
                ariaLabel={t("agents.model")}
              />
              {modelsError && <span style={{ color: "var(--status-danger)", fontSize: 10 }}>{modelsError}</span>}
            </SettingsField>
            <SettingsField label={t("agents.thinking")}>
              <SettingsSelect
                value={draft.thinking ?? ""}
                onChange={(value) => update("thinking", (value || undefined) as EditableProfile["thinking"])}
                options={THINKING_OPTIONS.map((value) => ({ value, label: value }))}
                emptyLabel={t("agents.inherit")}
                ariaLabel={t("agents.thinking")}
              />
            </SettingsField>
            <SettingsField label={t("agents.maxTurns")}>
              <SettingsNumInput
                value={draft.maxTurns !== undefined ? String(draft.maxTurns) : ""}
                onChange={(value) => update("maxTurns", value ? Number(value) : undefined)}
                placeholder="∞"
              />
            </SettingsField>
          </div>

          <SettingsField label={t("agents.behavior")}>
            <SettingsChipGroup
              label={t("agents.behavior")}
              disabled={disabled}
              options={[
                { value: "inheritContext", label: t("agents.inheritContext") },
                { value: "background", label: t("agents.background") },
              ]}
              selected={[
                ...(draft.inheritContext ? ["inheritContext"] : []),
                ...(draft.runInBackground ? ["background"] : []),
              ]}
              onToggle={(value, checked) => update(value === "inheritContext" ? "inheritContext" : "runInBackground", checked)}
            />
          </SettingsField>

          {selected && !editing && (
            <div style={{ ...labelValueGrid, ...detailGridStyle }}>
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{t("agents.tools")}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                {selected.tools.length > 0 ? selected.tools.join(", ") : "none"}
              </span>
            </div>
          )}
        </div>
      )}
    </SettingsPane>
  );
}
