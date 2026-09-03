"use client";

import type { ToolEntry } from "@/lib/tool-presets";
import { getToolParameterFields } from "@/lib/tool-parameters";
import { useI18n } from "@/hooks/useI18n";
import { useMemo, useState } from "react";
import { WrenchIcon } from "@phosphor-icons/react/Wrench";
import { XIcon } from "@phosphor-icons/react/X";

interface ToolsPanelProps {
  /** Full tool definitions for the active session (may include inactive entries). */
  tools: ToolEntry[];
  /** True while a fresh load is in flight. */
  loading?: boolean;
  /** Title shown in the panel header. */
  title: string;
  /** Invoked when the user requests to dismiss the panel. */
  onClose?: () => void;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ToolsPanel({ tools, loading = false, title, onClose }: ToolsPanelProps) {
  const { t } = useI18n();
  const activeTools = useMemo(() => tools.filter((tool) => tool.active), [tools]);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected =
    activeTools.find((tool) => tool.name === selectedName) ??
    activeTools.find((tool) => tool.name === "bash") ??
    activeTools[0] ??
    null;

  const fields = useMemo(
    () => (selected ? getToolParameterFields(selected.parameters) : []),
    [selected],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 420,
        maxWidth: 520,
        maxHeight: "70vh",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
        fontSize: 12,
        color: "var(--text)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--bg-secondary) 70%, transparent)",
          fontWeight: 600,
        }}
      >
        <WrenchIcon size={14} weight="regular" aria-hidden="true" />
        <span style={{ flex: 1 }}>{title}</span>
        {activeTools.length > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {t("tools.count", { count: activeTools.length })}
          </span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            aria-label={t("tools.close")}
            title={t("tools.close")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 20, height: 20, padding: 0,
              background: "none", border: "none", borderRadius: 4,
              color: "var(--text-muted)", cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <XIcon size={12} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>

      {loading && activeTools.length === 0 ? (
        <div style={{ padding: 16, color: "var(--text-dim)", textAlign: "center" }}>{t("tools.loading")}</div>
      ) : activeTools.length === 0 ? (
        <div style={{ padding: 16, color: "var(--text-dim)", textAlign: "center" }}>{t("tools.empty")}</div>
      ) : (
        <div style={{ display: "flex", minHeight: 0, overflow: "hidden" }}>
          {/* Left: tool sidebar */}
          <div
            style={{
              width: 180,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              overflowY: "auto",
              padding: 4,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {activeTools.map((tool) => {
              const isActive = selected?.name === tool.name;
              const paramCount = getToolParameterFields(tool.parameters).length;
              return (
                <button
                  key={tool.name}
                  onClick={() => setSelectedName(tool.name)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: 4,
                    background: isActive ? "var(--bg-selected)" : "none",
                    border: "none",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                    fontFamily: "var(--font-mono)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    transition: "background 0.1s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "none";
                  }}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{tool.name}</span>
                  {paramCount > 0 && (
                    <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>{paramCount}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: 12, minHeight: 0 }}>
            {selected && (
              <>
                <div style={{ fontWeight: 700, fontFamily: "var(--font-mono)", marginBottom: 4 }}>{selected.name}</div>
                {selected.description ? (
                  <p style={{ margin: 0, marginBottom: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {selected.description}
                  </p>
                ) : null}

                {fields.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontWeight: 600, color: "var(--text-muted)", marginBottom: 2 }}>
                      {t("tools.parameters")}
                    </div>
                    {fields.map((field) => (
                      <div
                        key={field.name}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                          padding: "6px 8px",
                          background: "var(--bg-hover)",
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{field.name}</span>
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--accent)",
                              background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                              padding: "1px 5px",
                              borderRadius: 4,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {field.type}
                          </span>
                          {field.required ? (
                            <span style={{ fontSize: 10, color: "var(--accent-red)" }}>{t("tools.required")}</span>
                          ) : null}
                        </div>
                        {field.description ? (
                          <div style={{ color: "var(--text-muted)", lineHeight: 1.4 }}>{field.description}</div>
                        ) : null}
                        {(field.defaultValue !== undefined || field.enumValues) ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, color: "var(--text-dim)" }}>
                            {field.defaultValue !== undefined && (
                              <span>
                                {t("tools.default")}: {formatValue(field.defaultValue)}
                              </span>
                            )}
                            {field.enumValues && field.enumValues.length > 0 && (
                              <span>
                                {t("tools.enum")}: {field.enumValues.map(formatValue).join(", ")}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: "var(--text-dim)" }}>{t("tools.noParameters")}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}