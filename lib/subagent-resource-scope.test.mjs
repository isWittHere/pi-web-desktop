import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  subagentNameList,
  extensionAddressableNames,
  scopeSubagentExtensions,
  subagentExtensionLoaderOptions,
} = await jiti.import("./subagents.ts");

test("a name list parses as leniently as `skills:` always did", () => {
  assert.deepEqual(subagentNameList(["a", " b ", "", "a"]), ["a", "b"]);
  assert.deepEqual(subagentNameList("a, b ,, a"), ["a", "b"]);
  assert.deepEqual(subagentNameList(undefined), []);
  assert.deepEqual(subagentNameList(42), []);
});

test("an extensions list scopes the loader to the named extensions only", () => {
  const extension = (path, source, tools = ["t"]) => ({
    path,
    sourceInfo: { source },
    tools: new Map(tools.map((name) => [name, {}])),
  });
  const base = {
    extensions: [
      extension("/root/extensions/codegraph/index.ts", "npm:codegraph"),
      extension("/root/extensions/other/index.ts", "npm:other"),
      extension("<inline:pi-web-exact>", ""),
    ],
    runtime: {
      pendingProviderRegistrations: [
        { extensionPath: "/root/extensions/codegraph/index.ts" },
        { extensionPath: "/root/extensions/other/index.ts" },
        { extensionPath: undefined },
      ],
    },
  };

  const scoped = subagentExtensionLoaderOptions({ loadExtensions: true, extensions: ["codegraph"] });
  assert.equal(scoped.noExtensions, false);
  const after = scoped.extensionsOverride(base);
  assert.deepEqual(after.extensions.map((e) => e.path), [
    "/root/extensions/codegraph/index.ts",
    "<inline:pi-web-exact>",
  ]);
  // A dropped extension's queued provider registrations never reach the runtime.
  assert.deepEqual(after.runtime.pendingProviderRegistrations, [
    { extensionPath: "/root/extensions/codegraph/index.ts" },
    { extensionPath: undefined },
  ]);
});

test("a name two sources claim keeps neither, and pi-web's own inline extensions always stay", () => {
  const extension = (path, source) => ({ path, sourceInfo: { source }, tools: new Map() });
  const base = {
    extensions: [
      extension("/a/extensions/shared/index.ts", ""),
      extension("/b/extensions/shared/index.ts", ""),
      extension("<inline:pi-web-exact>", ""),
    ],
    runtime: {},
  };
  const after = scopeSubagentExtensions(["shared"])(base);
  assert.deepEqual(after.extensions.map((e) => e.path), ["<inline:pi-web-exact>"]);
});

test("`*` loads every extension, and load_extensions: false wins over a list", () => {
  // `*` means no list at all: profileExtensions() drops it, so the loader is untouched.
  const off = subagentExtensionLoaderOptions({ loadExtensions: false, extensions: ["codegraph"] });
  assert.deepEqual(off, { noExtensions: true });
  const all = subagentExtensionLoaderOptions({ loadExtensions: true });
  assert.deepEqual(all, { noExtensions: false });
  assert.equal(subagentExtensionLoaderOptions({ loadExtensions: true, extensions: [] }).noExtensions, false);
});

test("an extensions name resolves the way an ext: selector does", () => {
  assert.deepEqual(
    extensionAddressableNames({ path: "/root/extensions/codegraph/index.ts", sourceInfo: { source: "npm:codegraph" } }).sort(),
    ["codegraph"],
  );
  // A directory name and a package name that disagree both address it.
  assert.deepEqual(
    extensionAddressableNames({ path: "/root/extensions/dir/index.ts", sourceInfo: { source: "npm:pkg" } }).sort(),
    ["dir", "pkg"],
  );
});

test("a profile's extensions list is read, kept on save, and a switch spelling still switches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-subagent-ext-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const { listSubagentProfiles, saveSubagentProfile } = await jiti.import("./subagents.ts");
    const cwd = join(dir, "project");
    mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
    const file = join(cwd, ".pi", "agents", "scoped.md");

    writeFileSync(file, [
      "---",
      "description: Scoped child",
      "load_extensions: true",
      "extensions:",
      "  - codegraph",
      "---",
      "",
      "Do the work.",
      "",
    ].join("\n"));

    const [profile] = listSubagentProfiles(cwd).filter((p) => p.name === "scoped");
    assert.equal(profile.loadExtensions, true);
    assert.deepEqual(profile.extensions, ["codegraph"]);

    // A save keeps the list exactly as authored: it is not this app's key to rewrite.
    const saved = saveSubagentProfile(cwd, "project", { ...profile, description: "Scoped child" });
    assert.deepEqual(saved.extensions, ["codegraph"]);
    const written = readFileSync(file, "utf8");
    assert.match(written, /extensions:\n {2}- codegraph\n/);
    assert.match(written, /load_extensions: true/);

    // `none` / `false` still switch extensions off, list or no list.
    writeFileSync(file, [
      "---",
      "description: Off child",
      "extensions: none",
      "---",
      "",
      "Do the work.",
      "",
    ].join("\n"));
    const [off] = listSubagentProfiles(cwd).filter((p) => p.name === "scoped");
    assert.equal(off.loadExtensions, false);
    assert.equal(off.extensions, undefined);

    // An empty list means none, not all.
    writeFileSync(file, [
      "---",
      "description: Empty child",
      "extensions: []",
      "---",
      "",
      "Do the work.",
      "",
    ].join("\n"));
    const [empty] = listSubagentProfiles(cwd).filter((p) => p.name === "scoped");
    assert.equal(empty.loadExtensions, true);
    assert.deepEqual(empty.extensions, []);

    rmSync(dir, { recursive: true, force: true });
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
