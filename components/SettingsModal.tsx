"use client";

import { useEffect, useRef, useState } from "react";
import { ChatCenteredText, Cpu, Monitor, Plug, Stack, X } from "@phosphor-icons/react";
import { ChatConfig } from "./ChatConfig";
import { DisplayConfig } from "./DisplayConfig";
import { ModelsConfig } from "./ModelsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
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

const tabIcons: Record<SettingsTab, typeof Cpu> = {
  display: Monitor,
  chat: ChatCenteredText,
  models: Cpu,
  skills: Stack,
  plugins: Plug,
};

/** Manager pages render their own list+detail columns; the page area then
 * stops scrolling as a whole so each column scrolls independently. */
const MANAGER_TABS: SettingsTab[] = ["models", "skills", "plugins"];

/**
 * Preference pages scroll as one document; manager pages hand scrolling
 * to their own list and detail columns.
 */
function pageAreaOverflow(isManager: boolean, isMobile: boolean): "hidden" | "auto" {
  // On mobile the manager columns stack, so the page area scrolls again
  // instead of clipping the stacked panels.
  return isManager && !isMobile ? "hidden" : "auto";
}

export function SettingsModal({
  initialTab = "models",
  cwd,
  sessionId,
  onCloseAction,
  onModelsSavedAction,
  onSessionReloadedAction,
}: SettingsModalProps) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab === "skills" || initialTab === "plugins" ? (cwd ? initialTab : "display") : initialTab,
  );
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

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", minHeight: 0, overflow: "hidden" }}>
          {/* Two-level sidebar: group labels + their pages. Scrolls on its
              own when the groups overflow. */}
          <nav
            aria-label={t("desktop.settingsSections")}
            className="settings-nav"
            style={{ width: isMobile ? undefined : 220 }}
          >
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
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {!cwd && <div className="settings-nav-note">{t("desktop.noWorkspaceSettings")}</div>}
          </nav>

          {/* Page area: one document scroll for preference pages; for
              manager pages the container stops scrolling so the manager's
              own list and detail columns each scroll independently. */}
          <div
            ref={contentScrollRef}
            style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflowY: pageAreaOverflow(isManager, isMobile) }}
          >
            {activeTab === "display" && <DisplayConfig />}
            {activeTab === "chat" && <ChatConfig cwd={cwd} />}
            {activeTab === "models" && <ModelsConfig cwd={cwd} onSavedAction={onModelsSavedAction} />}
            {cwd && activeTab === "skills" && <SkillsConfig cwd={cwd} />}
            {cwd && activeTab === "plugins" && <PluginsConfig cwd={cwd} sessionId={sessionId} onReloadedAction={onSessionReloadedAction} />}
          </div>
        </div>
      </section>
    </div>
  );
}