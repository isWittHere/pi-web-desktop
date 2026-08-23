"use client";

import { useEffect, useState } from "react";
import { SettingsBadge, SettingsPane } from "@/components/settings-ui";
import { useI18n } from "@/hooks/useI18n";

interface PromptInfo {
  name: string;
  description: string;
  argumentHint?: string;
  filePath: string;
  source?: string;
  scope?: "user" | "project" | "temporary";
  content: string;
}

interface PromptsResponse {
  prompts?: PromptInfo[];
  diagnostics?: Array<{ type: string; message: string }>;
  projectResourcesLoaded?: boolean;
}

function scopeTag(scope: PromptInfo["scope"]): "project" | "muted" {
  return scope === "project" ? "project" : "muted";
}

function shortenPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function PromptsConfig({ cwd }: { cwd: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<PromptsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/prompts?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((next: PromptsResponse | null) => {
        if (cancelled || !next) return;
        setData(next);
        setSelected((current) => {
          const first = next.prompts?.[0];
          if (!first) return null;
          return current && next.prompts?.some((prompt) => prompt.filePath === current)
            ? current
            : first.filePath;
        });
      })
      .catch((err) => setError(String(err)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const prompts = data?.prompts ?? [];
  const selectedPrompt = prompts.find((prompt) => prompt.filePath === selected) ?? null;

  return (
    <SettingsPane
      sidebar={
        <div style={{ padding: "8px 6px" }}>
          {loading ? (
            <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("desktop.loading")}</div>
          ) : error ? (
            <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--status-danger)" }}>{error}</div>
          ) : prompts.length === 0 ? (
            <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {t("desktop.noPromptsConfigured")}
            </div>
          ) : (
            prompts.map((prompt) => {
              const isSelected = selected === prompt.filePath;
              return (
                <div
                  key={prompt.filePath}
                  onClick={() => setSelected(prompt.filePath)}
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
                    if (!isSelected) e.currentTarget.style.background = "none";
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 400,
                      color: "var(--text)",
                      fontFamily: "var(--font-mono)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    /{prompt.name}
                  </span>
                  {prompt.scope === "project" && <SettingsBadge tone="project">{t("desktop.project")}</SettingsBadge>}
                </div>
              );
            })
          )}
        </div>
      }
    >
      <div style={{ padding: 20, minHeight: "100%", boxSizing: "border-box" }}>
        {loading ? null : selectedPrompt ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                /{selectedPrompt.name}
              </span>
              <SettingsBadge tone={scopeTag(selectedPrompt.scope)}>
                {t(`desktop.${selectedPrompt.scope === "project" ? "project" : "global"}`)}
              </SettingsBadge>
            </div>

            {selectedPrompt.argumentHint && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {selectedPrompt.argumentHint}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "minmax(96px, 130px) minmax(0, 1fr)", gap: "9px 14px", fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ color: "var(--text-dim)" }}>{t("desktop.description")}</div>
              <div style={{ color: "var(--text-muted)" }}>
                {selectedPrompt.description || "—"}
              </div>
              <div style={{ color: "var(--text-dim)" }}>{t("desktop.source")}</div>
              <div
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  overflowWrap: "anywhere",
                }}
              >
                {shortenPath(selectedPrompt.filePath)}
              </div>
            </div>

            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg-panel)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {t("desktop.preview")}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 420,
                  overflowY: "auto",
                }}
              >
                {selectedPrompt.content}
              </pre>
            </div>
          </div>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-dim)",
              fontSize: 13,
            }}
          >
            {t("desktop.noPromptsConfigured")}
          </div>
        )}
      </div>
    </SettingsPane>
  );
}