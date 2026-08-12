"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import {
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { ProviderIcon } from "@/components/ProviderIcon";
import type { DiscoveredModel } from "@/lib/model-discovery";
import type { ModelThinkingProfile, ThinkingRequestSpec } from "@/lib/thinking-request-core";
import { buildProfileFromFields } from "@/lib/thinking-request-core";
import { THINKING_LEVELS, type ThinkingLevel } from "@/lib/thinking-levels";
import {
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  type ModelCostDraft,
  type ModelCostKey,
} from "./models-config-helpers";
import {
  getProviderIconMode,
  getProviderIconModesVersion,
  PROVIDER_ICON_MODES,
  setProviderIconMode,
  subscribeProviderIconModes,
  type ProviderIconMode,
} from "@/lib/provider-icon";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  supportsApiKey?: boolean;
}

interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  supportsOAuth?: boolean;
}

type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
}

interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type ModelDiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

function useModelTranslation() {
  const { t } = useI18n();
  return useCallback(
    (key: string, values?: Record<string, string | number>) => t(key, values),
    [t],
  );
}

const FAVORITE_MODELS_KEY = "pi-favorite-models";

function readFavoriteModels(): Set<string> {
  try {
    const stored = localStorage.getItem(FAVORITE_MODELS_KEY);
    return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

/** Favorite state shared with the ChatInput model selector (`provider:modelId`). */
function useFavoriteModels(): { favorites: Set<string>; toggleFavorite: (key: string) => void } {
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavoriteModels());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAVORITE_MODELS_KEY) setFavorites(readFavoriteModels());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(FAVORITE_MODELS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return { favorites, toggleFavorite };
}

// ── Form field helpers ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  padding: "6px 9px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const,
};

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    style={{ ...inputStyle, fontFamily: mono ? "var(--font-mono)" : "inherit" }} />;
}

function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: React.CSSProperties;
}) {
  const t = useModelTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 34, fontFamily: mono ? "var(--font-mono)" : "inherit" }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("desktop.modelsHideApiKey") : t("desktop.modelsShowApiKey")}
        title={visible ? t("desktop.modelsHideApiKey") : t("desktop.modelsShowApiKey")}
        style={{
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
          width: 24,
          height: 24,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visible ? <EyeSlashIcon size={15} /> : <EyeIcon size={15} />}
      </button>
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />;
}

function Select({ value, onChange, options, required }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean }) {
  const t = useModelTranslation();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, color: value ? "var(--text)" : "var(--text-dim)" }}>
      {!required && <option value="">{t("desktop.modelsInheritNone")}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{children}</div>;
}

// ── Provider detail ───────────────────────────────────────────────────────────

function ProviderDetail({ name, provider, onChange, onRename, onDelete, onAddModels }: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void;
}) {
  const t = useModelTranslation();
  const [editingName, setEditingName] = useState(name);
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const discoveryRequestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);
  useEffect(() => setEditingName(name), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  useEffect(() => {
    discoveryRequestIdRef.current += 1;
    setDiscoveryState({ phase: "idle" });
    setDiscoveryQuery("");
    setSelectedModelIds([]);
  }, [name, provider.baseUrl, provider.api, provider.apiKey]);

  const handleDiscoverModels = useCallback(async () => {
    if (!provider.baseUrl?.trim() || discoveryState.phase === "loading") return;
    const requestId = ++discoveryRequestIdRef.current;
    setDiscoveryState({ phase: "loading" });
    setSelectedModelIds([]);
    try {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: name, provider: { ...provider, models: undefined } }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; endpoint?: string; error?: string };
      if (requestId !== discoveryRequestIdRef.current) return;
      if (!res.ok || data.error || !data.models) {
        setDiscoveryState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setDiscoveryState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl ?? "" });
    } catch (error) {
      if (requestId !== discoveryRequestIdRef.current) return;
      setDiscoveryState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [discoveryState.phase, name, provider]);

  const existingModelIds = new Set((provider.models ?? []).map((model) => model.id));
  const discoveredModels = discoveryState.phase === "success" ? discoveryState.models : [];
  const normalizedDiscoveryQuery = discoveryQuery.trim().toLocaleLowerCase();
  const filteredDiscoveredModels = discoveredModels.filter((model) => !normalizedDiscoveryQuery
    || model.id.toLocaleLowerCase().includes(normalizedDiscoveryQuery)
    || model.name?.toLocaleLowerCase().includes(normalizedDiscoveryQuery));
  const shownDiscoveredModels = filteredDiscoveredModels.slice(0, 300);
  const selectableShownIds = shownDiscoveredModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => model.id);
  const selectedCount = selectedModelIds.filter((id) => !existingModelIds.has(id)).length;
  const allShownSelected = selectableShownIds.length > 0
    && selectableShownIds.every((id) => selectedModelIds.includes(id));
  const someShownSelected = !allShownSelected
    && selectableShownIds.some((id) => selectedModelIds.includes(id));

  useEffect(() => {
    if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected;
  }, [someShownSelected]);

  const toggleDiscoveredModel = (id: string) => {
    setSelectedModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };

  const toggleShownModels = () => {
    const shownIds = new Set(selectableShownIds);
    setSelectedModelIds((current) => allShownSelected
      ? current.filter((id) => !shownIds.has(id))
      : Array.from(new Set([...current, ...selectableShownIds])));
  };

  const addSelectedModels = () => {
    if (discoveryState.phase !== "success") return;
    const selected = new Set(selectedModelIds);
    const additions = discoveryState.models.filter((model) => selected.has(model.id) && !existingModelIds.has(model.id));
    if (additions.length === 0) return;
    onAddModels(additions);
    setSelectedModelIds([]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("desktop.modelsProvider")}</SectionTitle>
        <button onClick={onDelete}
          style={{ padding: "3px 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11 }}>
          {t("desktop.delete")}
        </button>
      </div>

      <Field label={t("desktop.modelsProviderName")}>
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <button onClick={() => onRename(editingName.trim())}
            style={{ marginTop: 4, padding: "3px 10px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, alignSelf: "flex-start" }}>
            {t("desktop.rename")}
          </button>
        )}
      </Field>

      <Field label={t("desktop.modelsBaseUrl")}>
        <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1" mono />
      </Field>

      <Field label={t("desktop.modelsApiKey")}>
        <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
          placeholder={t("desktop.modelsApiKeyPlaceholder")} mono />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          {t("desktop.modelsApiKeyHelp")}
        </span>
      </Field>

      <Field label={t("desktop.modelsApi")}>
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={handleDiscoverModels}
            disabled={!provider.baseUrl?.trim() || discoveryState.phase === "loading"}
            style={{ padding: "6px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 5, fontSize: 11, cursor: (!provider.baseUrl?.trim() || discoveryState.phase === "loading") ? "not-allowed" : "pointer", color: (!provider.baseUrl?.trim() || discoveryState.phase === "loading") ? "var(--text-dim)" : "var(--text-muted)" }}>
            {discoveryState.phase === "loading" ? t("desktop.modelsImportingModels") : t("desktop.modelsImportModels")}
          </button>
          {discoveryState.phase === "success" && (
            <>
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  ref={selectShownRef}
                  type="checkbox"
                  checked={allShownSelected}
                  onChange={toggleShownModels}
                  aria-label={t("desktop.modelsImportSelectShown")}
                  style={{ margin: 0, cursor: "pointer" }}
                />
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("desktop.modelsImportSelectShown")}</span>
              </span>
              <button onClick={addSelectedModels} disabled={selectedCount === 0}
                style={{ padding: "4px 8px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: selectedCount === 0 ? "not-allowed" : "pointer", fontSize: 11, opacity: selectedCount === 0 ? 0.5 : 1 }}>
                {selectedCount > 0 ? t("desktop.modelsImportAddSelectedCount", { count: selectedCount }) : t("desktop.modelsImportAddSelected")}
              </button>
            </>
          )}
        </div>
        {discoveryState.phase === "error" && (
          <span style={{ fontSize: 11, color: "#ef4444" }}>{discoveryState.message}</span>
        )}
        {discoveryState.phase === "success" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={discoveryQuery}
              onChange={(e) => setDiscoveryQuery(e.target.value)}
              placeholder={t("desktop.modelsImportFilter", { count: discoveryState.models.length })}
              aria-label={t("desktop.modelsImportFilterLabel")}
              style={{ ...inputStyle, fontSize: 11 }}
            />
            <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)" }}>
              {filteredDiscoveredModels.length === 0 ? (
                <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 11 }}>{t("desktop.modelsImportNoMatches")}</div>
              ) : shownDiscoveredModels.map((model) => {
                const alreadyAdded = existingModelIds.has(model.id);
                const isSelected = selectedModelIds.includes(model.id);
                return (
                  <label key={model.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", cursor: alreadyAdded ? "default" : "pointer", opacity: alreadyAdded ? 0.55 : 1 }}>
                    <input
                      type="checkbox"
                      checked={alreadyAdded || isSelected}
                      disabled={alreadyAdded}
                      onChange={() => toggleDiscoveredModel(model.id)}
                      style={{ margin: 0, cursor: alreadyAdded ? "default" : "pointer" }}
                    />
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.id}</span>
                    {model.name && model.name !== model.id && (
                      <span style={{ fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{model.name}</span>
                    )}
                    {alreadyAdded && <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>{t("desktop.modelsImportAdded")}</span>}
                  </label>
                );
              })}
            </div>
            <span title={discoveryState.endpoint} style={{ fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {shownDiscoveredModels.length < filteredDiscoveredModels.length
                ? t("desktop.modelsImportShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                : t("desktop.modelsImportFetched", { count: discoveryState.models.length })}
            </span>
          </div>
        )}
      </div>

      <Field label={t("desktop.providerIcon")}>
        <IconModePicker providerId={name} api={provider.api} />
      </Field>

      <Field label={t("desktop.modelsHeaders")}>
        <HeaderListEditor
          headers={provider.headers}
          onChange={(headers) => set("headers", headers)}
        />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          {t("desktop.modelsHeadersHelp")}
        </span>
      </Field>
    </div>
  );
}

// ── Provider icon mode picker ─────────────────────────────────────────────────

const ICON_MODE_LABEL_KEYS: Record<ProviderIconMode, string> = {
  auto: "desktop.providerIconAuto",
  api: "desktop.providerIconApi",
  letter: "desktop.providerIconLetter",
};

/** Segmented 3-way picker (auto / api / letter) with live icon previews. */
function IconModePicker({ providerId, api }: { providerId: string; api?: string }) {
  const t = useModelTranslation();
  useSyncExternalStore(subscribeProviderIconModes, getProviderIconModesVersion, () => 0);
  const current = getProviderIconMode(providerId);

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {PROVIDER_ICON_MODES.map((m) => {
        const isActive = current === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => setProviderIconMode(providerId, m)}
            aria-pressed={isActive}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: isActive ? "var(--bg-selected)" : "var(--bg-panel)",
              color: isActive ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer", fontSize: 11,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-panel)"; }}
          >
            <ProviderIcon id={providerId} api={api} size={12} mode={m} />
            {t(ICON_MODE_LABEL_KEYS[m])}
          </button>
        );
      })}
    </div>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────

// 权威等级集合来自 lib/thinking-levels（与选择器、请求共用）。
const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off:     "var(--text-dim)",
  minimal: "var(--text-muted)",
  low:     "#60a5fa",
  medium:  "#a78bfa",
  high:    "#f472b6",
  xhigh:   "#fb923c",
  max:     "#ef4444",
};

function ThinkingLevelMapEditor({
  value,
  onChange,
  profile,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
  /** 已保存状态的权威 profile（/api/models），用于状态标注与请求预览。 */
  profile?: ModelThinkingProfile | null;
}) {
  const t = useModelTranslation();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const color = LEVEL_COLORS[level];

        const btnBase: React.CSSProperties = {
          padding: "4px 10px",
          fontSize: 10,
          border: "none",
          cursor: "pointer",
          fontWeight: 400,
          transition: "background 0.1s, color 0.1s",
          whiteSpace: "nowrap",
          background: "var(--bg-panel)",
          color: "var(--text-dim)",
        };
        const btnActive: React.CSSProperties = {
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
        };
        const btnActiveDisabled: React.CSSProperties = {
          background: "#ef4444",
          color: "#fff",
          fontWeight: 600,
        };

        return (
          <div
            key={level}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 4px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid transparent",
            }}
          >
            {/* Level badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, width: 68, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, opacity: state === "null" ? 0.3 : 1 }} />
              <span style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: state === "null" ? "var(--text-dim)" : "var(--text-muted)",
                textDecoration: state === "null" ? "line-through" : "none",
              }}>
                {level}
              </span>
            </div>

            {/* Default + Disabled buttons */}
            <div style={{ display: "flex", borderRadius: 5, border: "1px solid var(--border)", overflow: "hidden", flexShrink: 0 }}>
              <button
                onClick={() => setLevel(level, "omit")}
                style={{ ...btnBase, ...(state === "omit" ? btnActive : {}) }}
              >
                {t("desktop.modelsDefault")}
              </button>
              <button
                onClick={() => setLevel(level, null)}
                style={{ ...btnBase, borderLeft: "1px solid var(--border)", ...(state === "null" ? btnActiveDisabled : {}) }}
              >
                {t("desktop.modelsDisabled")}
              </button>
            </div>

            {/* Custom button + input fused */}
            <div style={{ display: "flex", borderRadius: 5, border: `1px solid ${state === "string" ? "var(--accent)" : "var(--border)"}`, overflow: "hidden", transition: "border-color 0.1s" }}>
              <button
                onClick={() => setLevel(level, strVal || level)}
                style={{ ...btnBase, ...(state === "string" ? btnActive : {}), borderRight: "1px solid var(--border)", flexShrink: 0 }}
              >
                {t("desktop.modelsCustom")}
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: state === "string" ? "var(--bg)" : "var(--bg-panel)",
                  border: "none",
                  outline: "none",
                  color: state === "string" ? "var(--text)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  padding: "4px 7px",
                  transition: "background 0.1s, color 0.1s",
                }}
              />
            </div>
            {/* 实际请求预览 + 状态（来自已保存 profile） */}
            {(() => {
              const spec: ThinkingRequestSpec | undefined = profile?.requests?.[level];
              let preview: string | null = null;
              if (spec) {
                if (spec.kind === "effort") preview = t("desktop.modelsThinkingEffort", { value: spec.effort ?? "" });
                else if (spec.kind === "toggle") preview = spec.enabled ? t("desktop.modelsThinkingOn") : t("desktop.modelsThinkingOff");
                else if (spec.kind === "budget") preview = t("desktop.modelsThinkingBudget", { tokens: String(spec.budgetTokens ?? "") });
                else preview = t("desktop.modelsThinkingUnavailable");
              }
              let statusHint: string | null = null;
              if (profile) {
                const effective = profile.map?.[level];
                if (effective === null) statusHint = t("desktop.modelsDisabled");
                else if (profile.levels.includes(level)) statusHint = t("desktop.modelsActive");
                else statusHint = t("desktop.modelsNotEnabled");
              }
              return (
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                  {statusHint && (
                    <span style={{ fontSize: 9, color: statusHint === t("desktop.modelsActive") ? "var(--text-dim)" : "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {statusHint}
                    </span>
                  )}
                  {preview && (
                    <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                      {preview}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

// ── Model detail ──────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

// Generic helper for boolean compat flags. An empty compat map is collapsed to
// `undefined` so the saved models.json stays free of `{}` noise.
function setCompatBool(model: ModelEntry, key: string, value: boolean): ModelEntry {
  const next = { ...(model.compat ?? {}) };
  if (value) next[key] = true;
  else delete next[key];
  return { ...model, compat: Object.keys(next).length ? next : undefined };
}

// Compat can be configured at the provider or model level; provider-composer
// merges them (model wins) at runtime. The UI reads the effective value so
// hand-edited models.json settings are reflected correctly, while toggles
// write to the model entry so a per-model override is explicit.
function effectiveCompat(provider: ProviderEntry, model: ModelEntry): Record<string, unknown> {
  return { ...(provider.compat ?? {}), ...(model.compat ?? {}) };
}

// Editable key/value header list for a provider or model entry. Rebuilds a
// fresh object on each edit so empty keys/values are dropped instead of being
// persisted as noise.
function HeaderListEditor({ headers, onChange }: {
  headers: Record<string, string> | undefined;
  onChange: (h: Record<string, string> | undefined) => void;
}) {
  const t = useModelTranslation();
  const entries = Object.entries(headers ?? {});
  const setEntry = (row: number, k: string, v: string): void => {
    const next: Record<string, string> = {};
    entries.forEach(([ok, ov], j) => { if (j !== row) next[ok] = ov; });
    if (k.trim()) next[k.trim()] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const removeEntry = (row: number): void => {
    const next = entries.filter((_, j) => j !== row);
    onChange(Object.keys(next).length ? Object.fromEntries(next) : undefined);
  };
  const rowBtnStyle = {
    padding: "6px 9px",
    background: "none",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 4,
    color: "#ef4444",
    cursor: "pointer",
    fontSize: 11,
    lineHeight: 1,
  } satisfies React.CSSProperties;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input value={k} onChange={(e) => setEntry(i, e.target.value, v)}
            placeholder="Header-Name" style={{ ...inputStyle, fontFamily: "var(--font-mono)", flex: 1 }} />
          <input value={v} onChange={(e) => setEntry(i, k, e.target.value)}
            placeholder="value" style={{ ...inputStyle, fontFamily: "var(--font-mono)", flex: 1 }} />
          <button onClick={() => removeEntry(i)} style={rowBtnStyle}>✕</button>
        </div>
      ))}
      <button onClick={() => onChange({ ...(headers ?? {}), "": "" })}
        style={{ padding: "5px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, alignSelf: "flex-start" }}>
        <PlusIcon size={11} /> {t("desktop.modelsAddHeader")}
      </button>
    </div>
  );
}

function ModelDetail({
  providerName,
  provider,
  model,
  isFavorite,
  onToggleFavorite,
  onChange,
  onDelete,
  profile,
  memory,
  onForgetMemory,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
  /** 已保存状态的权威 profile（用于请求预览列）。 */
  profile?: ModelThinkingProfile | null;
  /** 该模型的 per-model 记忆（上次实际生效等级）。 */
  memory?: string | null;
  onForgetMemory?: () => void;
}) {
  const t = useModelTranslation();
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  // 编辑态实时预览：模型是 models[] 条目，用户层 thinkingLevelMap 即最终 map（provider-composer 替换语义）。
  const liveProfile = useMemo(() => {
    if (!profile) return null;
    return buildProfileFromFields(profile.meta, model.thinkingLevelMap ?? {});
  }, [profile, model.thinkingLevelMap]);
  const costFieldLabels = {
    input: t("desktop.modelsCostInput"),
    output: t("desktop.modelsCostOutput"),
    cacheRead: t("desktop.modelsCostCacheRead"),
    cacheWrite: t("desktop.modelsCostCacheWrite"),
  } as const;
  const [costEditing, setCostEditing] = useState(false);
  const [costDraft, setCostDraft] = useState<ModelCostDraft>(() => modelCostToDraft(model.cost));
  const costDraftRef = useRef(costDraft);
  const costTemplateRef = useRef(model.cost);
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  // Commit a cost draft into the model entry. A blank field counts as 0 so the
  // saved cost group is always complete (the SDK's calculateCost reads all four
  // rates; a partial group would produce NaN in usage.cost.total). An all-blank
  // draft or any invalid value removes the cost group instead of saving junk.
  const setCost = (key: ModelCostKey, value: string) => {
    const nextDraft = { ...costDraftRef.current, [key]: value };
    const completeCost = parseCompleteModelCost(nextDraft);
    const nextModel = { ...model };
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    if (completeCost) {
      nextModel.cost = { ...(costTemplateRef.current ?? {}), ...completeCost };
      costTemplateRef.current = nextModel.cost;
    } else {
      delete nextModel.cost;
    }
    onChange(nextModel);
  };
  const toggleCostEditing = () => {
    if (costEditing) {
      setCostEditing(false);
      return;
    }
    costTemplateRef.current = model.cost;
    const nextDraft = modelCostToDraft(model.cost);
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    setCostEditing(true);
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return t("desktop.modelsTestingConnection");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return [t("desktop.modelsConnected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
    return [t("desktop.modelsFailed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("desktop.modelsModelSection")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {testSummary && (
            <span
              title={testSummary}
              style={{
                maxWidth: 260,
                height: 24,
                padding: "0 8px",
                border: `1px solid ${testState.phase === "error" ? "#fecaca" : testState.phase === "success" ? "#bbf7d0" : "var(--border)"}`,
                borderRadius: 4,
                background: testState.phase === "error" ? "#fee2e2" : testState.phase === "success" ? "#dcfce7" : "#e5e7eb",
                color: "#111827",
                fontSize: 11,
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                boxSizing: "border-box",
              }}
            >
              {testSummary}
            </span>
          )}
          <button
            onClick={handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
            title={t("desktop.modelsTestConnection")}
            style={{
              height: 24,
              padding: "0 8px",
              background: testState.phase === "success" ? "#16a34a" : "none",
              border: `1px solid ${testState.phase === "success" ? "#16a34a" : "var(--border)"}`,
              borderRadius: 4,
              color: testState.phase === "success" ? "#fff" : (!model.id.trim() || testState.phase === "testing") ? "var(--text-dim)" : "var(--text-muted)",
              cursor: (!model.id.trim() || testState.phase === "testing") ? "not-allowed" : "pointer",
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              gap: 5,
            }}
          >
            {testState.phase === "success" && <CheckIcon size={11} />}
            {testState.phase === "testing" ? t("desktop.modelsTesting") : testState.phase === "success" ? t("desktop.modelsOk") : t("desktop.modelsTest")}
          </button>
          <button onClick={onDelete}
            style={{ height: 24, padding: "0 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11, boxSizing: "border-box" }}>
            {t("desktop.modelsRemove")}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("desktop.modelsIdRequired")}><TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono /></Field>
        <Field label={t("desktop.modelsName")}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("desktop.modelsDisplayName")} />
            </div>
            <button
              type="button"
              onClick={onToggleFavorite}
              disabled={!model.id.trim()}
              aria-label={isFavorite ? t("desktop.unfavorite") : t("desktop.favorite")}
              title={isFavorite ? t("desktop.unfavorite") : t("desktop.favorite")}
              style={{ padding: 0, background: "none", border: "none", cursor: model.id.trim() ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", flexShrink: 0, opacity: model.id.trim() ? 1 : 0.4 }}
            >
              <StarIcon size={16} weight={isFavorite ? "fill" : "regular"} color={isFavorite ? "var(--accent)" : "var(--text-muted)"} />
            </button>
          </div>
        </Field>
      </div>

      <Field label={t("desktop.modelsApiOverride")}>
        <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
      </Field>

      <Field label={t("desktop.modelsHeaders")}>
        <HeaderListEditor
          headers={model.headers}
          onChange={(headers) => set("headers", headers)}
        />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          {t("desktop.modelsHeadersModelHelp")}
        </span>
      </Field>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Check label={t("desktop.modelsReasoningThinking")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
        <Check label={t("desktop.modelsImageInput")} checked={model.input?.includes("image") ?? false}
          onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
      </div>

      {model.reasoning && (
        <>
          <Check
            label={t("desktop.modelsDeepSeekCompat")}
            checked={hasDeepseekCompat(model)}
            onChange={(v) => onChange(setDeepseekCompat(model, v))}
          />
          <Check
            label={t("desktop.modelsSupportsDeveloperRole")}
            checked={effectiveCompat(provider, model)["supportsDeveloperRole"] !== false}
            onChange={(v) => onChange(setCompatBool(model, "supportsDeveloperRole", v))}
          />
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <SectionTitle>{t("desktop.modelsThinkingLevelMap")}</SectionTitle>
              {model.thinkingLevelMap && (
                <button
                  onClick={() => set("thinkingLevelMap", undefined)}
                  style={{ fontSize: 10, padding: "2px 7px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer" }}
                >
                  {t("desktop.modelsClearAll")}
                </button>
              )}
            </div>
            {memory && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                <span>{t("desktop.modelsLastUsed", { level: memory })}</span>
                <button
                  type="button"
                  onClick={onForgetMemory}
                  style={{ fontSize: 10, padding: "1px 6px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer" }}
                >
                  {t("desktop.modelsForgetMemory")}
                </button>
              </div>
            )}
            <ThinkingLevelMapEditor
              value={model.thinkingLevelMap}
              onChange={(v) => set("thinkingLevelMap", v)}
              profile={liveProfile ?? profile}
            />
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("desktop.modelsContextWindow")}>
          <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
            onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
        </Field>
        <Field label={t("desktop.modelsMaxOutputTokens")}>
          <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
            onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
        </Field>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <SectionTitle>{t("desktop.modelsCostPerMillionTokens")}</SectionTitle>
          <button
            type="button"
            onClick={toggleCostEditing}
            aria-expanded={costEditing}
            style={{ padding: "2px 4px", border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: 10 }}
          >
            {costEditing ? t("desktop.modelsCostDoneEditing") : t("desktop.modelsCostEdit")}
          </button>
        </div>
        {costEditing ? (
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
              <Field key={k} label={costFieldLabels[k]}>
                <NumInput value={costDraft[k]} onChange={(v) => setCost(k, v)} placeholder="0" />
              </Field>
            ))}
            {hasModelCostDraftValue(costDraft) && !parseCompleteModelCost(costDraft) && (
              <div aria-live="polite" style={{ gridColumn: "1 / -1", color: "#d97706", fontSize: 10 }}>
                {t("desktop.modelsCostAllRequired")}
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
            {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => {
              const value = model.cost?.[k];
              const missing = value === undefined;
              return (
                <div key={k} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {costFieldLabels[k]}
                  </div>
                  <div style={{ marginTop: 3, color: missing ? "var(--text-dim)" : "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                    {missing ? t("desktop.modelsCostNotProvided") : `$${String(value)}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────

function OAuthDetail({ provider, onRefresh }: { provider: OAuthProvider; onRefresh: () => void }) {
  const t = useModelTranslation();
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onRefresh();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: t("desktop.modelsConnectionLost") });
    };
  }, [provider.id, onRefresh, t]);

  const handleLogout = useCallback(async () => {
    try {
      const res = await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setLoginState({
          phase: "error",
          message: res.status === 409
            ? t("desktop.modelsAuthenticationStateChanged")
            : (data?.error ?? `HTTP ${res.status}`),
        });
      } else {
        setLoginState({ phase: "idle" });
      }
    } catch (error) {
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      onRefresh();
    }
  }, [provider.id, onRefresh, t]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: t("desktop.modelsVerifying") });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? t("desktop.modelsServerError", { status: res.status }) });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("desktop.modelsNetworkError") });
    }
  }, [provider.id, t]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: t("desktop.modelsContinuing") });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? t("desktop.modelsServerError", { status: res.status }) });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : t("desktop.modelsNetworkError") });
    }
  }, [provider.id, t]);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("desktop.modelsSubscription")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.loggedIn ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.loggedIn ? "#4ade80" : "var(--text-dim)" }}>
            {provider.loggedIn ? t("desktop.modelsConnected") : t("desktop.modelsNotConnected")}
          </span>
        </div>
      </div>

      {/* Status */}
      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {provider.loggedIn ? t("desktop.modelsAlreadyConnected") : t("desktop.modelsConnectAccount", { provider: provider.name })}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.modelsOpeningBrowser")}</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{ padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? t("desktop.modelsCompleteSignIn")
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {t("desktop.modelsBrowserDidNotOpen")}{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                  {t("desktop.modelsOpenLoginPage")}
                </a>
                .
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? t("desktop.modelsEnterValue"))}
                style={{ flex: 1, padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{ padding: "6px 12px", background: inputValue.trim() ? "var(--accent)" : "var(--bg-panel)", border: "none", borderRadius: 5, color: inputValue.trim() ? "#fff" : "var(--text-dim)", cursor: inputValue.trim() ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 600, flexShrink: 0 }}
              >
                {t("desktop.submit")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t("desktop.modelsOpenVerificationPage")}
            </p>
            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` ${t("desktop.modelsExpiresInMinutes", { count: Math.ceil(loginState.expiresInSeconds / 60) })}` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
          <p style={{ margin: 0, fontSize: 12, color: "#4ade80" }}>{t("desktop.modelsConnectedSuccessfully")}</p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
            style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
          >
            {t("desktop.cancel")}
          </button>
        ) : (
          <>
            <button
              onClick={handleLogin}
              style={{ padding: "5px 14px", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              {provider.loggedIn ? t("desktop.modelsReLogin") : t("desktop.modelsLogin")}
            </button>
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{ padding: "5px 12px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: 12 }}
              >
                {t("desktop.modelsDisconnect")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── API Key detail ────────────────────────────────────────────────────────────

function ApiKeyDetail({ provider, onRefresh }: { provider: ApiKeyProvider; onRefresh: () => void }) {
  const t = useModelTranslation();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(res.status === 409
          ? t("desktop.modelsAuthenticationStateChanged")
          : (d.error ?? `HTTP ${res.status}`));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      onRefresh();
      setRemoving(false);
    }
  }, [provider.id, onRefresh, t]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("desktop.modelsApiKey")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.configured ? "#4ade80" : "var(--text-dim)" }}>
            {provider.configured ? t("desktop.modelsConfigured") : t("desktop.modelsNotConfigured")}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {provider.configured
          ? t("desktop.modelsApiKeyStored")
          : t("desktop.modelsEnableModels", {
            provider: provider.displayName,
            count: provider.modelCount,
            models: provider.modelCount === 1 ? t("desktop.modelsSingular") : t("desktop.modelsPlural"),
          })}
      </p>

      <Field label={t("desktop.modelsApiKey")}>
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
            placeholder={provider.configured ? t("desktop.modelsEnterNewKey") : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "#16a34a" : apiKey.trim() ? "var(--accent)" : "var(--bg-panel)",
              border: "none", borderRadius: 5,
              color: (apiKey.trim() || savedOk) ? "#fff" : "var(--text-dim)",
              cursor: (saving || !apiKey.trim() || savedOk) ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 600, flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {savedOk && <CheckIcon size={12} />}
            {savedOk ? t("desktop.modelsSaved") : saving ? t("desktop.modelsSaving") : t("desktop.modelsSave")}
          </button>
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{error}</p>}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 5, color: "#ef4444",
            cursor: removing ? "not-allowed" : "pointer", fontSize: 12,
          }}
        >
          {removing ? t("desktop.modelsRemoving") : t("desktop.modelsDisconnect")}
        </button>
      )}
    </div>
  );
}

// ── Add provider picker ───────────────────────────────────────────────────────

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

function AddProviderPicker({
  oauthProviders, apiKeyProviders,
  onSelectOAuth, onSelectApiKey, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const t = useModelTranslation();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardStyle: React.CSSProperties = {
    display: "flex", flexDirection: "row", alignItems: "center", gap: 8,
    padding: "10px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    boxSizing: "border-box",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition: "border-color 0.12s, background 0.12s",
    width: "100%",
  };



  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 820, maxWidth: "calc(100vw / var(--app-ui-scale, 1) - 32px)", maxHeight: "min(calc(72vh / var(--app-ui-scale, 1)), calc(100vh / var(--app-ui-scale, 1) - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* Search */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <MagnifyingGlassIcon size={13} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder={t("desktop.modelsSearchProviders")}
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
          />
        </div>

        {/* Card grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div style={{ padding: "20px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>{t("desktop.modelsNoProvidersMatch")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
              {showCustom && (
                <div style={{ gridColumn: "1 / -1", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("desktop.modelsCustom")}</div>
              )}
              {showCustom && (
                <button
                  onClick={() => { onAddCustom(); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("desktop.modelsCompatibleProvider")}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("desktop.modelsCustomEndpointFormat")}</div>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: 5, background: "var(--bg-hover)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <PlusIcon size={13} style={{ color: "var(--text-dim)" }} />
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: showCustom ? 6 : 0, fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("desktop.modelsSubscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>OAuth</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableOAuth.length > 0 ? 6 : 0, fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("desktop.modelsApiKey")}</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("desktop.modelsCount", { count: p.modelCount })}</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelsConfig({
  embedded = false,
  onCloseAction,
  onSavedAction,
  cwd,
}: {
  embedded?: boolean;
  onCloseAction?: () => void;
  onSavedAction?: () => void;
  cwd?: string | null;
}) {
  const t = useModelTranslation();
  const isMobile = useIsMobile();
  const { favorites: favoriteModels, toggleFavorite } = useFavoriteModels();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [profiles, setProfiles] = useState<Record<string, ModelThinkingProfile>>({});
  const [thinkingLevelMemory, setThinkingLevelMemory] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveWarnings, setSaveWarnings] = useState<string[] | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadOAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers: OAuthProvider[] }) => setOauthProviders(d.providers))
      .catch(() => {});
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers: ApiKeyProvider[] }) => setApiKeyProviders(d.providers))
      .catch(() => {});
  }, []);

  const refreshAuthenticationProviders = useCallback(() => {
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders]);

  useEffect(() => {
    fetch("/api/models-config")
      .then((r) => r.json())
      .then((d: ModelsJson) => {
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
      })
      .catch(() => setConfig({ providers: {} }))
      .finally(() => setLoading(false));
    refreshAuthenticationProviders();
    // 加载已保存状态的权威推理强度 profile，供请求预览列展示。
    const modelsUrl = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
    fetch(modelsUrl)
      .then((r) => r.json())
      .then((d: { thinkingProfiles?: Record<string, ModelThinkingProfile>; thinkingLevelMemory?: Record<string, string> }) => {
        setProfiles(d.thinkingProfiles ?? {});
        setThinkingLevelMemory(d.thinkingLevelMemory ?? {});
      })
      .catch(() => {});
  }, [refreshAuthenticationProviders, cwd]);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const addDiscoveredModels = useCallback((providerName: string, discovered: DiscoveredModel[]) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      const existingIds = new Set(models.map((model) => model.id));
      for (const discoveredModel of discovered) {
        if (existingIds.has(discoveredModel.id)) continue;
        existingIds.add(discoveredModel.id);
        models.push({ id: discoveredModel.id, name: discoveredModel.name });
      }
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setConfig((prev) => {
      const remaining = Object.keys(prev.providers ?? {});
      setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
      return prev;
    });
  }, []);

  const addModel = useCallback((providerName: string) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setConfig((prev) => {
      const idx = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index: idx });
      return prev;
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveWarnings(null);
    setSavedOk(false);
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const d = await res.json() as { success?: boolean; error?: string; warnings?: string[] };
      if (!res.ok || d.error) setSaveError(d.error ?? `HTTP ${res.status}`);
      else {
        setSavedOk(true);
        if (d.warnings?.length) {
          setSaveWarnings(d.warnings);
        }
        onSavedAction?.();
        // 保存后刷新 profile（服务端已重新合并 thinkingLevelMap）。
        const modelsUrl = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
        fetch(modelsUrl)
          .then((r) => r.json())
          .then((d2: { thinkingProfiles?: Record<string, ModelThinkingProfile>; thinkingLevelMemory?: Record<string, string> }) => {
            setProfiles(d2.thinkingProfiles ?? {});
            setThinkingLevelMemory(d2.thinkingLevelMemory ?? {});
          })
          .catch(() => {});
        setTimeout(() => setSavedOk(false), 2000);
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, onSavedAction, cwd]);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  const activeApiKey = apiKeyProviders.filter((p) => p.configured);

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <OAuthDetail key={p.id} provider={p} onRefresh={refreshAuthenticationProviders} />;
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <ApiKeyDetail key={p.id} provider={p} onRefresh={refreshAuthenticationProviders} />;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
          onAddModels={(models) => addDiscoveredModels(selection.name, models)}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    const memoryKey = `${selection.providerName}/${model.id}`;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        isFavorite={favoriteModels.has(`${selection.providerName}:${model.id}`)}
        onToggleFavorite={() => toggleFavorite(`${selection.providerName}:${model.id}`)}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
        profile={profiles[`${selection.providerName}:${model.id}`]}
        memory={thinkingLevelMemory[memoryKey] ?? null}
        onForgetMemory={() => {
          fetch("/api/thinking-level-memory", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelKey: memoryKey }),
          }).catch(() => {});
          setThinkingLevelMemory((prev) => {
            const next = { ...prev };
            delete next[memoryKey];
            return next;
          });
        }}
      />
    );
  })();

  return (
    <>
    <div
      style={embedded
        ? { display: "flex", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }
        : { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (!embedded && e.target === e.currentTarget) onCloseAction?.(); }}
    >
      <div style={embedded
        ? { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }
        : { width: isMobile ? "calc(100vw / var(--app-ui-scale, 1) - 16px)" : 860, maxWidth: "calc(100vw / var(--app-ui-scale, 1) - 16px)", height: isMobile ? "calc(100dvh / var(--app-ui-scale, 1) - 16px)" : "calc(78vh / var(--app-ui-scale, 1))", maxHeight: "calc(100dvh / var(--app-ui-scale, 1) - 16px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>

        {!embedded && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("desktop.models")}</span>
              <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>~/.pi/agent/models.json</code>
            </div>
            <button onClick={onCloseAction} aria-label={t("desktop.modelsClose")} title={t("desktop.modelsClose")} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>

          {/* Left: tree */}
          <div style={{
            width: isMobile ? "100%" : 210,
            maxHeight: isMobile ? "calc(40vh / var(--app-ui-scale, 1))" : undefined,
            borderRight: isMobile ? "none" : "1px solid var(--border)",
            borderBottom: isMobile ? "1px solid var(--border)" : "none",
            display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)",
          }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {/* Active OAuth subscriptions */}
              {activeOAuth.map((p) => {
                const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelection({ type: "oauth", providerId: p.id })}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  </div>
                );
              })}

              {/* Active API key providers */}
              {activeApiKey.map((p) => {
                const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelection({ type: "apikey", providerId: p.id })}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</span>
                  </div>
                );
              })}

              {/* Divider before custom providers, only when there are active managed providers */}
              {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
              )}

              {/* Custom providers */}
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.modelsLoading")}</div>
              ) : providers.map(([pName, pData]) => {
                const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                const models = pData.models ?? [];
                return (
                  <div key={pName} style={{ marginBottom: 2 }}>
                    {/* Provider row */}
                    <div
                      onClick={() => setSelection({ type: "provider", name: pName })}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: 5, cursor: "pointer", background: isProviderSelected ? "var(--bg-selected)" : "none" }}
                      onMouseEnter={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "none"; }}
                    >
                      <ProviderIcon id={pName} api={pData.api} size={12} />
                      <span style={{ fontSize: 12, fontWeight: isProviderSelected ? 600 : 400, color: "var(--text)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pName}
                      </span>
                    </div>

                    {/* Model rows */}
                    {models.map((m, i) => {
                      const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                      const isFav = favoriteModels.has(`${pName}:${m.id}`);
                      return (
                        <div
                          key={i}
                          onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 26px", borderRadius: 5, cursor: "pointer", background: isModelSelected ? "var(--bg-selected)" : "none" }}
                          onMouseEnter={(e) => { if (!isModelSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isModelSelected) e.currentTarget.style.background = "none"; }}
                        >
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: m.id ? "var(--text-muted)" : "var(--text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.id || t("desktop.modelsNewModel")}
                          </span>
                          <StarIcon
                            size={11}
                            weight={isFav ? "fill" : "regular"}
                            color={isFav ? "var(--accent)" : "var(--text-dim)"}
                            style={{ flexShrink: 0, opacity: isFav ? 1 : 0.45 }}
                            aria-hidden="true"
                          />
                        </div>
                      );
                    })}

                    {/* Add model button */}
                    <div
                      onClick={(e) => { e.stopPropagation(); addModel(pName); }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px 4px 26px", borderRadius: 5, cursor: "pointer", color: "var(--text-dim)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                    >
                      <span style={{ fontSize: 11 }}>{t("desktop.modelsAddModel")}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add provider */}
            <div style={{ borderTop: "1px solid var(--border)", padding: "8px 6px" }}>
              <button onClick={() => setPickerOpen(true)} style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                width: "100%", padding: "6px 0", background: "none", border: "1px dashed var(--border)", borderRadius: 5,
                color: "var(--text-muted)", cursor: "pointer", fontSize: 12,
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                {t("desktop.modelsAddProvider")}
              </button>
            </div>
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {loading ? null : detailContent ?? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
                {t("desktop.modelsSelectProviderOrModel")}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {saveWarnings && (
            <span style={{ fontSize: 11, color: "#f59e0b", flex: 1, lineHeight: 1.4 }}>
              {t("desktop.modelsConfigBuiltinConflict", { models: saveWarnings.join(", ") })}
            </span>
          )}
          {saveError && <span style={{ fontSize: 12, color: "#f87171", flex: 1 }}>{saveError}</span>}
          {!embedded && (
            <button onClick={onCloseAction} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
              {t("desktop.cancel")}
            </button>
          )}
          <button onClick={handleSave} disabled={saving || savedOk} style={{
            position: "relative",
            padding: "6px 16px",
            minWidth: 92,
            background: savedOk ? "#16a34a" : saving ? "var(--bg-panel)" : "var(--accent)",
            border: "none", borderRadius: 6,
            color: savedOk ? "#fff" : saving ? "var(--text-muted)" : "#fff",
            cursor: (saving || savedOk) ? "default" : "pointer", fontSize: 13, fontWeight: 600,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "background-color 0.2s ease, color 0.2s ease",
            animation: savedOk ? "saved-pop 0.45s ease" : undefined,
          }}>
            {savedOk && (
              <CheckIcon
                size={14}
                style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}
              />
            )}
            <span>{savedOk ? t("desktop.modelsSaved") : saving ? t("desktop.modelsSaving") : t("desktop.modelsSave")}</span>
          </button>
        </div>
      </div>
    </div>
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
        onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
        onAddCustom={addCustomProvider}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}
