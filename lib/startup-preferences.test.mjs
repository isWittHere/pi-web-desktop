import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const { persistExplicitStartupPreferences } = await createJiti(import.meta.url)
  .import("./startup-preferences.ts");

async function withSettings(run) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-startup-preferences-"));
  const cwd = join(root, "cwd");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  try {
    const settings = SettingsManager.create(cwd, agentDir);
    await run(settings, join(agentDir, "settings.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("persists effective explicit model and thinking defaults", async () => {
  await withSettings(async (settings, settingsPath) => {
    const result = await persistExplicitStartupPreferences(
      settings,
      {
        model: { provider: "deepseek", modelId: "deepseek-chat" },
        thinkingLevel: "xhigh",
      },
      {
        model: { provider: "deepseek", modelId: "deepseek-chat" },
        thinkingLevel: "high",
        supportsThinking: true,
      },
    );

    const saved = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(
      [saved.defaultProvider, saved.defaultModel, saved.defaultThinkingLevel],
      ["deepseek", "deepseek-chat", "high"],
    );
    assert.equal(result.modelDefaultChanged, true);
  });
});

test("does not overwrite defaults for implicit or fallback selections", async () => {
  await withSettings(async (settings) => {
    settings.setDefaultModelAndProvider("saved", "saved-model");
    settings.setDefaultThinkingLevel("medium");
    await settings.flush();

    const implicit = await persistExplicitStartupPreferences(settings, {}, {
      model: { provider: "scoped", modelId: "scoped-model" },
      thinkingLevel: "high",
      supportsThinking: true,
    });
    const fallback = await persistExplicitStartupPreferences(
      settings,
      { model: { provider: "requested", modelId: "requested-model" } },
      { model: { provider: "fallback", modelId: "fallback-model" }, thinkingLevel: "off", supportsThinking: false },
    );

    assert.equal(implicit.modelDefaultChanged, false);
    assert.equal(fallback.modelDefaultChanged, false);
    assert.equal(settings.getDefaultProvider(), "saved");
    assert.equal(settings.getDefaultModel(), "saved-model");
    assert.equal(settings.getDefaultThinkingLevel(), "medium");
  });
});

test("retains a thinking default when a non-thinking model resolves off", async () => {
  await withSettings(async (settings) => {
    settings.setDefaultThinkingLevel("high");
    await settings.flush();

    await persistExplicitStartupPreferences(
      settings,
      { thinkingLevel: "off" },
      { thinkingLevel: "off", supportsThinking: false },
    );

    assert.equal(settings.getDefaultThinkingLevel(), "high");
  });
});
