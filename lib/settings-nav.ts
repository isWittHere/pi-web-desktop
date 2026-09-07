/**
 * Settings navigation model — pure data so the structure can be unit-tested
 * without rendering. The SettingsModal maps these sections/items onto the
 * sidebar layout; each labelKey must exist in both i18n catalogs.
 */

export type SettingsTab = "display" | "chat" | "models" | "skills" | "agents" | "plugins" | "prompts";

export interface SettingsNavItem {
  id: SettingsTab;
  labelKey: string;
}

export interface SettingsNavSection {
  id: string;
  labelKey: string;
  /** "global" settings apply app-wide; "workspace" settings need a cwd. */
  scope: "global" | "workspace";
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    id: "general",
    labelKey: "desktop.settingsGroupGeneral",
    scope: "global",
    items: [
      { id: "display", labelKey: "desktop.display" },
      { id: "chat", labelKey: "desktop.chat" },
    ],
  },
  {
    id: "models",
    labelKey: "desktop.settingsGroupModels",
    scope: "global",
    items: [{ id: "models", labelKey: "desktop.models" }],
  },
  {
    id: "workspace",
    labelKey: "desktop.settingsGroupWorkspace",
    scope: "workspace",
    items: [
      { id: "skills", labelKey: "desktop.skills" },
      { id: "agents", labelKey: "desktop.agents" },
      { id: "plugins", labelKey: "desktop.plugins" },
      { id: "prompts", labelKey: "desktop.prompts" },
    ],
  },
];

/** Page-level descriptions shown under the settings page title. */
export const SETTINGS_PAGE_DESCRIPTIONS: Record<SettingsTab, string> = {
  display: "desktop.settingsPageDisplay",
  chat: "desktop.settingsPageChat",
  models: "desktop.settingsPageModels",
  skills: "desktop.settingsPageSkills",
  agents: "desktop.settingsPageAgents",
  plugins: "desktop.settingsPagePlugins",
  prompts: "desktop.settingsPagePrompts",
};

/** Flattened nav items, in display order. */
export function settingsNavItems(): SettingsNavItem[] {
  return SETTINGS_NAV.flatMap((section) => section.items);
}

/** Resolve the section a tab belongs to (used for scope markers). */
export function settingsSectionOf(tab: SettingsTab): SettingsNavSection | undefined {
  return SETTINGS_NAV.find((section) => section.items.some((item) => item.id === tab));
}