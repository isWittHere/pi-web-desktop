"use client";

import { useEffect, useRef, useState } from "react";
import { ChatCenteredText, Cpu, Monitor, Plug, Stack, TextT, UsersThree, X } from "@phosphor-icons/react";
import { ChatConfig } from "./ChatConfig";
import { DisplayConfig } from "./DisplayConfig";
import { ModelsConfig } from "./ModelsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PromptsConfig } from "./PromptsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { SettingsPane } from "./settings-ui";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { countEffectiveSubagentProfiles } from "@/lib/subagent-profile-precedence";
import type { SubagentProfile } from "@/lib/subagents";
import {
  SETTINGS_NAV,
  settingsNavItems,
  settingsSectionOf,
  type SettingsTab,
} from "@/lib/settings-nav";

export type { SettingsTab } from "@/lib/settings-nav";

interface SettingsModalProps {
  initialTab?: SettingsTab;
  cwd: string | null;
  sessionId: string | null;
  onCloseAction: () => void;
  onModelsSavedAction: () => void;
  onSessionReloadedAction: () => void;
}

/** Counts shown on the nav badges (skills total, agents enabled/total,
 * plugins loaded/configured). */
interface SettingsNavStats {
  skills: number | null;
  agents: { enabled: number; total: number } | null;
  plugins: { loaded: number; configured: number } | null;
}

const EMPTY_NAV_STATS: SettingsNavStats = { skills: null, agents: null, plugins: null };

const tabIcons: Record<SettingsTab, typeof Cpu> = {
  display: Monitor,
  chat: ChatCenteredText,
  models: Cpu,
  skills: Stack,
  agents: UsersThree,
  plugins: Plug,
  prompts: TextT,
};

/** Manager pages render their own list+detail panes; the SettingsPane body
 * then stops scrolling so the manager's columns scroll independently. */
const MANAGER_TABS: SettingsTab[] = ["models", "skills", "agents", "plugins", "prompts"];

export function SettingsModal({
  initialTab = "models",
  cwd,
  sessionId,
  onCloseAction,
  onModelsSavedAction,
  onSessionReloadedAction,
}: SettingsModalProps) {
  const isMobile = useIsMobile();  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab === "skills" || initialTab === "plugins" || initialTab === "agents" ? (cwd ? initialTab : "display") : initialTab,
  );
  const [navStats, setNavStats] = useState<SettingsNavStats>(EMPTY_NAV_STATS);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // One scroll container for the page area: pages flow inside it together
  // and no inner panel scrolls on its own.
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Focus the dialog on open so keyboard users land inside immediately,
  // and restore the trigger's focus when the dialog unmounts.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus();
    };
  }, []);

  // Each page owns its scroll position — reset when switching tabs so a
  // short page never opens mid-scroll after a long one.
  useEffect(() => {
    contentScrollRef.current?.scrollTo(0, 0);
  }, [activeTab]);

  // Nav badges: skill count, subagent availability and plugin load status for
  // the current workspace.
  useEffect(() => {
    if (!cwd) {
      setNavStats(EMPTY_NAV_STATS);
      return;
    }
    let cancelled = false;
    setNavStats((prev) => ({ ...prev, plugins: null, skills: null, agents: null }));
    void fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { skills?: unknown[] } | null) => {
        if (!cancelled && data) setNavStats((prev) => ({ ...prev, skills: data.skills?.length ?? null }));
      })
      .catch(() => {});
    // Shadowed profiles are listed as separate sources, so count only the ones
    // that actually win their scope, and gate on the built-in master switch.
    void Promise.all([
      fetch(`/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`),
      fetch("/api/subagents/settings"),
    ])
      .then(async ([profilesRes, settingsRes]) => {
        const profilesData = profilesRes.ok
          ? (await profilesRes.json()) as { profiles?: SubagentProfile[] }
          : null;
        const settingsData = settingsRes.ok
          ? (await settingsRes.json()) as { enabled?: boolean }
          : null;
        const all = profilesData?.profiles;
        if (cancelled || !all) return;
        setNavStats((prev) => ({
          ...prev,
          agents: countEffectiveSubagentProfiles(all, settingsData?.enabled === true),
        }));
      })
      .catch(() => {});
    void fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { packages?: { status?: string }[] } | null) => {
        const packages = data?.packages;
        if (!cancelled && packages) {
          setNavStats((prev) => ({
            ...prev,
            plugins: {
              loaded: packages.filter((pkg) => pkg.status === "loaded").length,
              configured: packages.length,
            },
          }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // Trap Tab navigation inside the dialog so the focus cannot escape into
  // the app behind the modal while it is open.
  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      onCloseAction();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  const activeSection = settingsSectionOf(activeTab);
  const activeItem = settingsNavItems().find((item) => item.id === activeTab);
  const isManager = MANAGER_TABS.includes(activeTab);

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
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Escape") onCloseAction();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("desktop.settings")}
        onKeyDown={handleDialogKeyDown}
        style={{
          width: isMobile ? "calc(100vw / var(--app-ui-scale, 1) - 16px)" : "min(1200px, calc(100vw / var(--app-ui-scale, 1) - 32px))",
          maxWidth: "calc(100vw / var(--app-ui-scale, 1) - 16px)",
          height: isMobile ? "calc(100dvh / var(--app-ui-scale, 1) - 16px)" : "calc(90vh / var(--app-ui-scale, 1))",
          maxHeight: "calc(100dvh / var(--app-ui-scale, 1) - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Single title row: 设置 / 分组 / 当前页 */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span className="settings-breadcrumb" role="navigation" aria-label={t("desktop.settingsBreadcrumb")}>
            <span className="crumb-root">{t("desktop.settings")}</span>
            {activeSection && (
              <>
                <span className="crumb-sep" aria-hidden="true">/</span>
                <span>{t(activeSection.labelKey)}</span>
              </>
            )}
            {activeItem && (
              <>
                <span className="crumb-sep" aria-hidden="true">/</span>
                <span className="crumb-current">{t(activeItem.labelKey)}</span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={onCloseAction}
            title={t("desktop.closeSettings")}
            aria-label={t("desktop.closeSettings")}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, display: "flex", flexShrink: 0 }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <SettingsPane
          sidebar={
            <nav aria-label={t("desktop.settingsSections")} className="settings-nav">
              {SETTINGS_NAV.map((section) => {
                const workspaceLocked = section.scope === "workspace" && !cwd;
                return (
                  <div key={section.id}>
                    <div className="settings-nav-group">{t(section.labelKey)}</div>
                    {section.items.map((item) => {
                      const Icon = tabIcons[item.id];
                      const active = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={workspaceLocked}
                          onClick={() => setActiveTab(item.id)}
                          aria-current={active ? "page" : undefined}
                          className="settings-nav-item"
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span>{t(item.labelKey)}</span>
                          {item.id === "skills" && navStats.skills !== null && (
                            <span className="settings-nav-badge" aria-hidden="true">{navStats.skills}</span>
                          )}
                          {item.id === "agents" && navStats.agents && (
                            <span className="settings-nav-badge" aria-hidden="true">
                              {navStats.agents.enabled}/{navStats.agents.total}
                            </span>
                          )}
                          {item.id === "plugins" && navStats.plugins && (
                            <span className="settings-nav-badge" aria-hidden="true">
                              {navStats.plugins.loaded}/{navStats.plugins.configured}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {!cwd && <div className="settings-nav-note">{t("desktop.noWorkspaceSettings")}</div>}
            </nav>
          }
          bodyScroll={isManager && !isMobile ? "hidden" : "auto"}
          bodyRef={contentScrollRef}
        >
          {activeTab === "display" && <DisplayConfig />}
          {activeTab === "chat" && <ChatConfig cwd={cwd} sessionId={sessionId} onSessionReloaded={onSessionReloadedAction} />}
          {activeTab === "models" && <ModelsConfig cwd={cwd} onSavedAction={onModelsSavedAction} />}
          {cwd && activeTab === "skills" && <SkillsConfig cwd={cwd} />}
          {cwd && activeTab === "agents" && <AgentsConfig cwd={cwd} sessionId={sessionId} onReloadedAction={onSessionReloadedAction} />}
          {cwd && activeTab === "plugins" && <PluginsConfig cwd={cwd} sessionId={sessionId} onReloadedAction={onSessionReloadedAction} />}
          {cwd && activeTab === "prompts" && <PromptsConfig cwd={cwd} />}
        </SettingsPane>
      </section>
    </div>
  );
}