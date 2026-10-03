import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  isPowerShellToolEnabled,
  readPowerShellToolEnabled,
  resolveShellTools,
  writePowerShellToolEnabled,
} = await createJiti(import.meta.url).import("./powershell-settings.ts");

test("PowerShell is opt-in on Windows and never selected on other platforms", () => {
  assert.equal(isPowerShellToolEnabled(undefined, "win32"), false);
  assert.equal(isPowerShellToolEnabled(["read", "powershell"], "win32"), true);
  assert.equal(isPowerShellToolEnabled(["read", "bash", "powershell"], "win32"), false);
  assert.equal(isPowerShellToolEnabled(["read", "powershell"], "darwin"), false);
  assert.deepEqual(
    resolveShellTools(["read", "bash", "edit"], ["read", "powershell"], "win32"),
    ["read", "powershell", "edit"],
  );
  assert.deepEqual(
    resolveShellTools(["read", "bash", "edit"], ["read", "powershell"], "darwin"),
    ["read", "bash", "edit"],
  );
});

test("the setting preserves unrelated config and switches defaultTools both ways", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-"));
  const settingsPath = join(root, "settings.json");

  assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), false);
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultTools: ["read", "powershell", "edit", "write"],
  });

  const configured = JSON.parse(await readFile(settingsPath, "utf8"));
  configured.unrelated = { keep: true };
  await writeFile(settingsPath, JSON.stringify(configured));
  await writePowerShellToolEnabled(false, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultTools: ["read", "bash", "edit", "write"],
    unrelated: { keep: true },
  });
});

test("enabling PowerShell adds it when a custom defaultTools list has no shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-custom-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["read", "grep"] }));

  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(
    JSON.parse(await readFile(settingsPath, "utf8")).defaultTools,
    ["read", "grep", "powershell"],
  );
});

test("a shell swap preserves +codemode modifiers and appending to a modifier-only list keeps pi defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-modifier-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["+codemode"] }));

  // Appending "powershell" to a modifier-only list must keep pi's default tools
  // plus the +codemode effect, not collapse into a plain two-tool list.
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  const first = JSON.parse(await readFile(settingsPath, "utf8")).defaultTools;
  assert.ok(first.includes("read"));
  assert.ok(first.includes("powershell"));
  assert.ok(!first.includes("bash"), "enabling PowerShell swaps bash out");
  assert.ok(first.includes("edit"));
  assert.ok(first.includes("write"));
  assert.ok(first.includes("codemode"));
  assert.ok(!first.includes("+codemode"), "modifiers are resolved away on write");

  // Toggling back keeps the codemode addition.
  await writePowerShellToolEnabled(false, settingsPath, "win32");
  const second = JSON.parse(await readFile(settingsPath, "utf8")).defaultTools;
  assert.ok(second.includes("codemode"));
  assert.ok(second.includes("bash"));
  assert.ok(!second.includes("powershell"));
});

test("resolveDefaultToolEntries applies modifiers in list order", async () => {
  const { resolveDefaultToolEntries, isToolModifier } = await createJiti(import.meta.url)
    .import("./powershell-settings.ts");

  assert.equal(isToolModifier("+codemode"), true);
  assert.equal(isToolModifier("-bash"), true);
  assert.equal(isToolModifier("codemode"), false);
  // A plain list is returned as-is (a copy).
  assert.deepEqual(resolveDefaultToolEntries(["read", "edit"]), ["read", "edit"]);
  // A modifier-only list starts from pi's defaults.
  assert.deepEqual(
    resolveDefaultToolEntries(["+codemode"]),
    ["read", "bash", "edit", "write", "codemode"],
  );
  // -name removal applies after plain names.
  assert.deepEqual(
    resolveDefaultToolEntries(["read", "grep", "-grep", "+write"]),
    ["read", "write"],
  );
  // An empty list is empty, not the pi defaults.
  assert.deepEqual(resolveDefaultToolEntries([]), []);
});

test("invalid defaultTools are rejected without overwriting the settings file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-invalid-"));
  const settingsPath = join(root, "settings.json");
  const original = JSON.stringify({ defaultTools: "bash", unrelated: true });
  await writeFile(settingsPath, original);

  await assert.rejects(
    writePowerShellToolEnabled(true, settingsPath, "win32"),
    /defaultTools must be an array of strings/,
  );
  assert.equal(await readFile(settingsPath, "utf8"), original);
});
