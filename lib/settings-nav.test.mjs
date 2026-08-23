import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SETTINGS_NAV,
  SETTINGS_PAGE_DESCRIPTIONS,
  settingsNavItems,
  settingsSectionOf,
} = await jiti.import("./settings-nav.ts");
const { enLocale } = await jiti.import("./i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("./i18n/messages/zh-CN.ts");

test("nav section ids are unique and each has at least one item", () => {
  const ids = SETTINGS_NAV.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const section of SETTINGS_NAV) {
    assert.ok(section.items.length > 0, `section ${section.id} is empty`);
  }
});

test("nav item ids are unique", () => {
  const ids = settingsNavItems().map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every tab has a page description key", () => {
  for (const item of settingsNavItems()) {
    assert.ok(
      SETTINGS_PAGE_DESCRIPTIONS[item.id],
      `missing page description for ${item.id}`,
    );
  }
});

test("settingsSectionOf resolves the owning section", () => {
  assert.equal(settingsSectionOf("display")?.scope, "global");
  assert.equal(settingsSectionOf("skills")?.scope, "workspace");
  assert.equal(settingsSectionOf("plugins")?.scope, "workspace");
});

test("all nav and page-description keys exist in both catalogs", () => {
  const keys = [
    ...SETTINGS_NAV.flatMap((section) => [
      section.labelKey,
      ...section.items.map((item) => item.labelKey),
    ]),
    ...Object.values(SETTINGS_PAGE_DESCRIPTIONS),
  ];
  for (const key of keys) {
    assert.ok(key in enLocale.messages, `en missing ${key}`);
    assert.ok(key in zhCNLocale.messages, `zh-CN missing ${key}`);
  }
});