#!/usr/bin/env node
/**
 * Green / portable release builder for Pi Web.
 *
 * Workflow:
 *   1. (optional) git backup of modified work files (excludes ref-repos/)
 *   2. npm dedupe && npm run build   (flatten deps, produce .next/)
 *   3. npm prune --production        (strip devDependencies)
 *   4. electron-builder --win <target>
 *   5. npm install                   (restore devDependencies)
 *   6. archive (zip) the unpacked dir for the "green" portable package
 *
 * Usage:
 *   node scripts/build-release.mjs                # dir + zip (default green)
 *   node scripts/build-release.mjs --target=portable
 *   node scripts/build-release.mjs --target=nsis
 *   node scripts/build-release.mjs --no-zip
 *   node scripts/build-release.mjs --git-backup
 *   node scripts/build-release.mjs --no-clean
 *
 * Target precedence: CLI --target > env PI_WEB_RELEASE_TARGET > "dir".
 */
"use strict";

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

function log(s) { console.log(`\n[build-release] ${s}`); }

// Run with output streamed live to stdout
function run(cmd, args) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: ROOT,
    shell: process.platform === "win32",
  });
  if (r.status !== 0 && r.status !== null) {
    console.error(`[build-release] ERROR: ${cmd} exited ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r;
}

// Run with stdout captured for string checks
function cap(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: "pipe",
    cwd: ROOT,
    shell: process.platform === "win32",
  });
  const out = (r.stdout || Buffer.alloc(0)).toString().trim();
  return { status: r.status, stdout: out };
}

// ── parse CLI args ──────────────────────────────────────────────────────────
const raw = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const eq = a.indexOf("=");
  raw[a.slice(2, eq === -1 ? a.length : eq)] = eq === -1 ? true : a.slice(eq + 1);
}
const TARGET   = (raw.target ?? process.env.PI_WEB_RELEASE_TARGET ?? "dir").toLowerCase();
const DO_ZIP   = !raw["no-zip"];
const DO_BAK   = !!raw["git-backup"];
const DO_CLEAN = !raw["no-clean"];

const PKG     = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VER     = PKG.version;
const RELDIR  = join(ROOT, "release");
const UNPKDIR = join(RELDIR, "win-unpacked");

// ══════════════════════════════════════════════════════════════════════════════
// 1. Git backup (optional)
// ══════════════════════════════════════════════════════════════════════════════
if (DO_BAK) {
  log("Step 1: git backup (ref-repos excluded)");
  const s = cap("git", ["status", "--porcelain"]);
  if (s.status !== 0) { log("git unavailable, skip backup"); }
  else if (!s.stdout) { log("working tree clean"); }
  else {
    run("git", [
      "add", "-u",
      ":(exclude)ref-repos",
      ":(exclude)release",
      ":(exclude).next",
    ]);
    const d = cap("git", ["diff", "--cached", "--name-only"]);
    if (d.stdout) {
      run("git", ["commit", "-m", `Backup before release build v${VER}`]);
      log("backup committed");
    } else {
      log("nothing staged — skip commit");
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Clean + dedupe + next build
// ══════════════════════════════════════════════════════════════════════════════
log("Step 2: clean, dedupe & npm run build");
if (DO_CLEAN && existsSync(RELDIR)) {
  rmSync(RELDIR, { recursive: true, force: true });
}
mkdirSync(RELDIR, { recursive: true });

// Snapshot the pristine lockfile before any npm tree-mutation step. npm
// dedupe / prune / `npm install electron` / restore all re-resolve caret
// ranges and rewrite package-lock.json, silently drifting the committed
// dependency graph (and polluting git history). We restore this copy at the
// end so the working-tree lockfile is byte-identical to when the build began.
const LOCKFILE = join(ROOT, "package-lock.json");
const LOCK_BAK = join(RELDIR, ".package-lock.json.bak");
if (existsSync(LOCKFILE)) {
  cpSync(LOCKFILE, LOCK_BAK);
  log("  snapshot package-lock.json for restore");
}

// Guarantee the lockfile is restored even if the build fails partway through
// the npm mutation steps (dedupe / prune / electron install). The normal
// restore happens in Step 3c; this only fires on early exit while the backup
// still exists.
process.on("exit", (code) => {
  if (code !== 0 && existsSync(LOCK_BAK)) {
    try { cpSync(LOCK_BAK, LOCKFILE); } catch {}
    try { rmSync(LOCK_BAK, { force: true }); } catch {}
    log("  restored pristine package-lock.json (on failure)");
  }
});

// Flatten nested node_modules to reduce duplication in the final package.
// Safe to run even if the tree is already optimal — it only moves packages.
log("  npm dedupe …");
run("npm", ["dedupe"]);

run("npm", ["run", "build"]);

// ══════════════════════════════════════════════════════════════════════════════
// 2b. Convert .next/node_modules symlinks to real directories.
//     turbopack generates hashed module IDs (e.g. pi-coding-agent-4cdde81112ef3dc5)
//     that point to real npm packages via symlinks. electron-builder on Windows
//     doesn't follow symlinks, so the packaged app can't resolve these hashed names.
//     Replace each symlink with a copy of its real target.
// ══════════════════════════════════════════════════════════════════════════════
const NEXT_NM = join(ROOT, ".next", "node_modules");
if (existsSync(NEXT_NM)) {
  const entries = readdirSync(NEXT_NM);
  for (const name of entries) {
    const linkPath = join(NEXT_NM, name);
    try {
      const st = lstatSync(linkPath);
      if (!st.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    try {
      const target = readlinkSync(linkPath);
      if (!existsSync(target)) continue;
      rmSync(linkPath, { recursive: true, force: true });
      cpSync(target, linkPath, { recursive: true, dereference: true });
      log(`  .next/node_modules/${name} ← ${target}`);
    } catch (err) {
      log(`  warning: failed to resolve .next/node_modules/${name}: ${err.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2c. Strip devDependencies so only production packages end up in the
//     packaged app.  electron-builder sees whatever is in node_modules/
//     at packaging time, so we prune first and restore afterwards.
//     electron must be re-installed after prune because electron-builder
//     needs it to resolve the version and access platform binaries — but
//     the !node_modules/electron/** exclusion keeps it out of the package.
// ══════════════════════════════════════════════════════════════════════════════
log("Step 2c: npm prune --production");
run("npm", ["prune", "--production"]);

log("  reinstalling electron for builder");
// --package-lock=false: electron is a devDependency needed only so
// electron-builder can resolve its version/platform binaries, and it is
// excluded from the package anyway. Installing it must NOT rewrite
// package-lock.json (which would drift the committed electron pin).
run("npm", ["install", "--no-save", "--package-lock=false", "electron"]);

// ══════════════════════════════════════════════════════════════════════════════
// 3. electron-builder
// ══════════════════════════════════════════════════════════════════════════════
log(`Step 3: electron-builder --win ${TARGET}`);
run("npx", ["electron-builder", "--win", TARGET]);

// ══════════════════════════════════════════════════════════════════════════════
// 3b. electron-builder filters out any nested node_modules/ directory (including
//     .next/node_modules). Copy the converted hashed-package dirs into the
//     packaged app directly after packaging.
// ══════════════════════════════════════════════════════════════════════════════
if (existsSync(UNPKDIR) && existsSync(NEXT_NM)) {
  const appNextNm = join(UNPKDIR, "resources", "app", ".next", "node_modules");
  log("Step 3b: injecting .next/node_modules into packaged app");
  rmSync(appNextNm, { recursive: true, force: true });
  cpSync(NEXT_NM, appNextNm, { recursive: true });
  log("  done");
}

// ══════════════════════════════════════════════════════════════════════════════
// 3c. Restore devDependencies that were removed by prune so the working
//     tree is usable for development after the build finishes.
// ══════════════════════════════════════════════════════════════════════════════
log("Step 3c: npm install (restore devDependencies)");
// Restore the pristine lockfile captured at build start. The npm lifecycle
// steps above re-resolve caret ranges and would otherwise leave a rewritten
// package-lock.json behind. `npm install` below then rebuilds node_modules
// from this exact lockfile, so the working tree matches the committed deps.
if (existsSync(LOCK_BAK)) {
  cpSync(LOCK_BAK, LOCKFILE);
  rmSync(LOCK_BAK, { force: true });
  log("  restored pristine package-lock.json");
}
run("npm", ["install"]);

// ══════════════════════════════════════════════════════════════════════════════
// 4. Zip the unpacked dir (only meaningful for `dir` target)
// ══════════════════════════════════════════════════════════════════════════════
if (!DO_ZIP) {
  log("Step 4: skipped (--no-zip)");
} else if (!existsSync(UNPKDIR) || !statSync(UNPKDIR).isDirectory()) {
  log("Step 4: no win-unpacked/ (target was not 'dir').");
} else {
  const ZIP = join(RELDIR, `PiWeb-${VER}-portable-win.zip`);
  log(`Step 4: zipping -> ${ZIP}`);
  rmSync(ZIP, { force: true });

  if (process.platform === "win32") {
    // Windows 10+ bsdtar auto-detects zip format by .zip extension
    run("tar", ["-a", "-c", "-f", ZIP, "-C", RELDIR, "win-unpacked"]);
  } else {
    // macOS / Linux: rename to nice folder name, then use zip
    const NICE = join(RELDIR, "Pi Web");
    if (existsSync(NICE)) rmSync(NICE, { recursive: true, force: true });
    renameSync(UNPKDIR, NICE);
    try {
      run("zip", ["-r", "-q", ZIP, "Pi Web"]);
    } catch {
      // fallback: tar.gz
      const TGZ = join(RELDIR, `PiWeb-${VER}-portable-linux.tar.gz`);
      log(`zip not found, falling back to tar.gz -> ${TGZ}`);
      renameSync(NICE, UNPKDIR);
      run("tar", ["-czf", TGZ, "-C", RELDIR, "win-unpacked"]);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════════
log("✓ Build complete. Release artifacts:");
try {
  const items = readdirSync(RELDIR);
  items.forEach((f) => {
    const st = statSync(join(RELDIR, f));
    const sz = st.isDirectory() ? "DIR" : (st.size / 1024 / 1024).toFixed(1) + " MB";
    log(`  ${f}  (${sz})`);
  });
} catch {
  log(`  (see ${RELDIR}/)`);
}