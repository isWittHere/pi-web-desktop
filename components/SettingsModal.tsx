"use client";

import { useState } from "react";
import { Cpu, Plug, Stack, X } from "@phosphor-icons/react";
import { ModelsConfig } from "./ModelsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { useIsMobile } from "@/hooks/useIsMobile";

export type SettingsTab = "models" | "skills" | "plugins";

interface SettingsModalProps {
  initialTab?: SettingsTab;
  cwd: string | null;
  sessionId: string | null;
  onCloseAction: () => void;
  onModelsSavedAction: () => void;
  onSessionReloadedAction: () => void;
}

const tabs: { id: SettingsTab; label: string; Icon: typeof Cpu }[] = [
  { id: "models", label: "Models", Icon: Cpu },
  { id: "skills", label: "Skills", Icon: Stack },
  { id: "plugins", label: "Plugins", Icon: Plug },
];

export function SettingsModal({
  initialTab = "models",
  cwd,
  sessionId,
  onCloseAction,
  onModelsSavedAction,
  onSessionReloadedAction,
}: SettingsModalProps) {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab === "models" || cwd ? initialTab : "models",
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseAction();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 1000,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "80vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Settings</span>
            {activeTab === "models" ? (
              <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                ~/.pi/agent/models.json
              </code>
            ) : cwd && (
              <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cwd}
              </code>
            )}
          </div>
          <button
            type="button"
            onClick={onCloseAction}
            title="Close settings"
            aria-label="Close settings"
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, display: "flex" }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", minHeight: 0, overflow: "hidden" }}>
          <nav
            aria-label="Settings sections"
            style={{
              display: "flex",
              flexDirection: isMobile ? "row" : "column",
              gap: 4,
              width: isMobile ? "100%" : 150,
              padding: 8,
              flexShrink: 0,
              background: "var(--bg-panel)",
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
            }}
          >
            {tabs.map(({ id, label, Icon }) => {
              const disabled = id !== "models" && !cwd;
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setActiveTab(id)}
                  aria-current={active ? "page" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: isMobile ? 1 : undefined,
                    width: isMobile ? undefined : "100%",
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 6,
                    background: active ? "var(--bg-selected)" : "none",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    textAlign: "left",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(event) => {
                    if (!active && !disabled) {
                      event.currentTarget.style.background = "var(--bg-hover)";
                      event.currentTarget.style.color = "var(--text)";
                    }
                  }}
                  onMouseLeave={(event) => {
                    if (!active) {
                      event.currentTarget.style.background = "none";
                      event.currentTarget.style.color = "var(--text-muted)";
                    }
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          <div style={{ display: activeTab === "models" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
            <ModelsConfig embedded onSavedAction={onModelsSavedAction} />
          </div>
          {cwd && (
            <div style={{ display: activeTab === "skills" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
              <SkillsConfig cwd={cwd} embedded />
            </div>
          )}
          {cwd && (
            <div style={{ display: activeTab === "plugins" ? "flex" : "none", flex: 1, minWidth: 0, minHeight: 0 }}>
              <PluginsConfig cwd={cwd} sessionId={sessionId} embedded onReloadedAction={onSessionReloadedAction} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
