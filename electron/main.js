"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell } = require("electron");
const { fork } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const PORT = process.env.PORT || 30141;

// With asar:false, app.isPackaged returns false even in production.
// Detect dev vs production by checking if resources/ has app/ or app.asar.
const pkgRoot = path.join(process.resourcesPath, "app");
const asarRoot = path.join(process.resourcesPath, "app.asar");
const IS_DEV = !fs.existsSync(pkgRoot) && !fs.existsSync(asarRoot);

const HOSTNAME = "127.0.0.1";
const URL = `http://${HOSTNAME}:${PORT}`;

let mainWindow = null;
let serverProcess = null;
let tray = null;

// Diagnostic log for external-link handling. Also written to a file so the
// behavior can be verified without watching the terminal (the window's close
// button only hides to tray, so a stale main process can otherwise mask
// whether the new code is actually running).
const LOG_FILE = path.join(os.tmpdir(), "pi-web-electron.log");
function logToFile(...args) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${args.join(" ")}\n`);
  } catch { /* best effort */ }
}

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(`${URL}/api/home`, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error(`Port ${PORT} responded with HTTP ${res.statusCode}`));
      }).on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server did not start within ${timeoutMs}ms`));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

function startServer() {
  const pkgDir = path.join(__dirname, "..");

  // fork() spawns a new Node process using Electron's embedded Node.js
  // runtime. This works in both dev (node.exe) and production (the
  // packaged Electron exe), unlike spawn(process.execPath) which fails
  // in production because process.execPath is Pi Web.exe, not node.
  const nextBin = IS_DEV
    ? require.resolve("next/dist/bin/next", { paths: [pkgDir] })
    : path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");

  const args = IS_DEV
    ? ["dev", "-H", HOSTNAME, "-p", String(PORT), "--turbopack"]
    : ["start", "-H", HOSTNAME, "-p", String(PORT)];

  // Desktop always serves only the local BrowserWindow. Do not forward an
  // ambient PI_WEB_PASSWORD into that process: doing so would require exposing
  // credentials to Chromium or forcing an interactive Basic Auth challenge.
  const { PI_WEB_PASSWORD: _password, ...environment } = process.env;
  void _password;
  const env = IS_DEV
    ? { ...environment, ELECTRON_RUNNING: "1", PI_WEB_HOSTNAME: HOSTNAME }
    : { ...environment, NODE_ENV: "production", ELECTRON_RUNNING: "1", PI_WEB_HOSTNAME: HOSTNAME };

  serverProcess = fork(nextBin, args, {
    cwd: pkgDir,
    stdio: "inherit",
    env,
  });

  serverProcess.on("error", (err) => {
    dialog.showErrorBox("Server Error", `Failed to start Next.js server:\n${err.message}`);
    app.quit();
  });

  serverProcess.on("exit", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
}

function getIconPath() {
  // Windows keeps the .ico; macOS uses the rasterized Pi app icon. nativeImage
  // cannot load SVG, so icon-mac.png is rendered from public/icon.svg by
  // scripts/generate-icons.mjs (run automatically by electron:build).
  return path.join(__dirname, "..", "public", process.platform === "win32" ? "icon.ico" : "icon-mac.png");
}

function createTray() {
  // Windows keeps the existing tray icon; macOS uses the Pi template icon
  // (black + alpha) so the system adapts it to light/dark menu bars.
  const iconPath = process.platform === "darwin"
    ? path.join(__dirname, "tray-icon-mac.png")
    : path.join(__dirname, "tray-icon.png");
  const sourceIcon = nativeImage.createFromPath(iconPath);
  const trayIcon = process.platform === "darwin"
    ? sourceIcon.resize({ width: 16, height: 16, quality: "best" })
    : sourceIcon;
  if (process.platform === "darwin") trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip("Pi Agent Web");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: showMainWindow,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    showMainWindow();
  });
}

/**
 * Show the main window. With the temporary hide-on-close behavior the window
 * is never destroyed on close, so this is normally just show+focus. The
 * createWindow() fallback covers the rare case the window was actually
 * destroyed (e.g. full quit path).
 */
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function createWindow() {
  const iconPath = getIconPath();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    title: "Pi Agent Web",
    icon: iconPath,
    // macOS: keep the native frame so the traffic-light buttons render, but
    // hide the title bar text (the renderer draws its own title bar).
    // Windows/Linux: unchanged frameless window with custom controls.
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    trafficLightPosition: process.platform === "darwin" ? { x: 12, y: 11 } : undefined,
    backgroundColor: "#1a1a1a",
    // Start hidden: show() only fires after the splash has actually rendered
    // (ready-to-show below), so the user never sees an empty first frame or a
    // flash between window creation and the splash paint.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Only reveal the window once the in-window splash has painted. This kills
  // the startup flash: without it the window appears empty (backgroundColor)
  // for a few frames while loadFile(splash.html) is still in flight.
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Sync the renderer's document.title to the native window title,
  // so the workspace name (set by AppShell) appears in the title bar.
  mainWindow.webContents.on("page-title-updated", (_event, title) => {
    mainWindow.setTitle(title);
  });

  // ── External links ────────────────────────────────────────────────
  // Route external links (target="_blank" / window.open) to the system
  // browser via shell.openExternal instead of spawning an in-app
  // BrowserWindow. Same-origin URLs (e.g. the in-app session export
  // preview) are allowed to open in-app as before.
  //
  // IMPORTANT: only window.open / target="_blank" requests reach this
  // handler. The splash → app bootstrap (window.location.replace) goes
  // through will-navigate, which is intentionally NOT intercepted here:
  // guarding it with an incomplete same-origin check is what previously
  // left the window stuck on the splash screen.
  const isAppUrl = (rawUrl) => {
    const url = String(rawUrl || "");
    // Relative URLs always resolve against the app origin → in-app.
    if (url.startsWith("/")) return true;
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const localHost =
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1";
    const samePort = parsed.port === "" || parsed.port === String(PORT);
    return localHost && samePort;
  };

  // Strip junk Chromium may have glued onto the URL (trailing markdown
  // punctuation such as `)/`, whitespace) until it parses, so
  // shell.openExternal receives a clean address. Falls back to the trimmed
  // original if nothing parses.
  const cleanExternalUrl = (rawUrl) => {
    let url = String(rawUrl || "").trim();
    try {
      new URL(url);
      return url;
    } catch { /* fall through */ }
    url = url.replace(/[\s\r\n]+$/g, "").replace(/[)\]}>.,;:!?"']+$/g, "");
    try {
      new URL(url);
      return url;
    } catch { /* fall through */ }
    return url;
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logToFile("[window-open] received:", JSON.stringify(url));
    if (isAppUrl(url)) {
      logToFile("[window-open] allow same-origin:", JSON.stringify(url));
      return { action: "allow" };
    }
    const cleaned = cleanExternalUrl(url);
    if (/^https?:\/\//i.test(cleaned)) {
      logToFile("[window-open] opening external:", JSON.stringify(url), "->", cleaned);
      shell.openExternal(cleaned).then(
        () => logToFile("[window-open] openExternal ok:", cleaned),
        (err) => {
          console.error("[Electron] openExternal failed:", cleaned, err);
          logToFile("[window-open] openExternal FAILED:", cleaned, String(err));
        }
      );
    } else {
      logToFile("[window-open] denied non-web:", JSON.stringify(url));
    }
    return { action: "deny" };
  });

  // Enable DevTools toggle with Ctrl+Shift+I / F12
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && !input.isAutoRepeat) {
      const isDevToolsKey =
        (input.key === "F12") ||
        (input.control && input.shift && input.key === "I") ||
        (input.control && input.shift && input.key === "i");
      if (isDevToolsKey) {
        mainWindow.webContents.toggleDevTools();
      }
    }
  });

  const sendMaximizedState = () => {
    try {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.webContents &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send("window:maximized-changed", mainWindow.isMaximized());
      }
    } catch (err) {
      // A dead renderer must not let a maximize IPC error mask the real
      // crash cause — log it and move on.
      console.error("[Electron] sendMaximizedState failed:", err);
    }
  };
  mainWindow.on("maximize", sendMaximizedState);
  mainWindow.on("unmaximize", sendMaximizedState);

  // ── Renderer diagnostics ──────────────────────────────────────────────
  // Surface renderer crashes and console errors from the main process so
  // black screens / DevTools disconnects can be attributed from evidence
  // (reason + exitCode + console output) instead of guesswork.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[Electron] Renderer process gone:",
      JSON.stringify({ reason: details.reason, exitCode: details.exitCode, details }),
    );
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(
      "[Electron] did-fail-load:",
      JSON.stringify({ errorCode, errorDescription, validatedURL }),
    );
  });

  // `console-message` moved to an event-object API; the legacy positional
  // arguments are deprecated. Accept both so this works on any Electron.
  mainWindow.webContents.on("console-message", (event, legacyLevel, legacyMessage, legacyLine, legacySourceId) => {
    const level = typeof event.level === "number" ? event.level : legacyLevel;
    const message = event.message ?? legacyMessage;
    const lineNumber = event.lineNumber ?? legacyLine;
    const sourceId = event.sourceId ?? legacySourceId;
    if (level >= 3) {
      console.error(`[Renderer console] ${message} (${sourceId}:${lineNumber})`);
    }
  });

  // Load the in-window splash first (same window as the app): its script
  // polls the server and navigates this window to the web UI once it is up.
  // The app's HTML carries a CSS-only body::before Pi logo that covers the
  // JS-load + hydration gap; AppShell fades it out (html.pi-booted) once the
  // workspace + session content are ready — all in one window, no flash.
  mainWindow.loadFile(path.join(__dirname, "..", "public", "splash.html"));

  mainWindow.on("close", (event) => {
    // TEMPORARY: hide the window to the tray instead of destroying the UI.
    // The "destroy UI on close to free memory" optimization is disabled until
    // the startup/splash work is finalized for release. This restores the
    // pre-optimization behavior: close → hide; tray Show / double-click → show.
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("window:is-maximized", (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

// Open the native OS folder-picker dialog. Used by the workspace selector's
// "Select folder" action so users browse instead of typing a path.
ipcMain.handle("dialog:select-directory", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(window, {
    title: "Select folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("shell:open-theme-folder", async () => {
  const themeDirectory = path.join(app.getPath("home"), ".pi", "agent", "themes");
  try {
    fs.mkdirSync(themeDirectory, { recursive: true });
    return await shell.openPath(themeDirectory);
  } catch (error) {
    console.error("[Electron] Failed to open Pi theme folder:", error);
    return error instanceof Error ? error.message : String(error);
  }
});

ipcMain.handle("shell:open-theme-docs", () => {
  return shell.openExternal("https://pi.dev/docs/latest/themes");
});

// Reveal a file/folder in the system file explorer, selecting the item in its
// parent folder. Unlike openPath() it returns void, so existence is pre-checked
// here and the renderer gets a boolean it can trust. The path originates from
// the renderer's file explorer, which is already backed by the server-side
// allow-list; no new server API surface is introduced.
ipcMain.handle("shell:show-item-in-folder", async (_event, fullPath) => {
  if (typeof fullPath !== "string" || fullPath.length === 0) return false;
  try {
    if (!fs.existsSync(fullPath)) return false;
    shell.showItemInFolder(fullPath);
    return true;
  } catch (error) {
    console.error("[Electron] Failed to reveal item in folder:", error);
    return false;
  }
});

async function bootstrap() {
  if (process.platform === "darwin") {
    app.dock.setIcon(getIconPath());
  }
  // Open the main window immediately: it loads the in-window splash (same
  // window), whose script navigates to the web UI as soon as the server is
  // reachable. Meanwhile make sure the server is running.
  createTray();
  createWindow();
  try {
    await waitForServer(2000);
  } catch {
    startServer();
    try {
      await waitForServer(60000);
    } catch (err) {
      dialog.showErrorBox("Startup Error", `Failed to start Pi Web: ${err.message}`);
      app.quit();
      return;
    }
  }
}

// ── Single-instance lock ──────────────────────────────────────
// Prevent multiple copies of the app from running at the same time.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to launch a second instance → restore the existing window,
    // or recreate it if the user had closed it (server kept running).
    showMainWindow();
  });

  // macOS keeps a minimal native menu (appMenu + editMenu) so system
  // shortcuts like Cmd+C/V and Cmd+Q keep working with the hidden title bar.
  // Windows/Linux: no menu bar, matching the existing frameless look.
  const applicationMenu = process.platform === "darwin"
    ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }])
    : null;
  Menu.setApplicationMenu(applicationMenu);

  app.whenReady().then(bootstrap);
}

app.on("window-all-closed", () => {
  // TEMPORARY: with hide-on-close the window is never actually closed, so this
  // path is not exercised. Once the "destroy UI on close to free memory"
  // optimization ships, this is where the renderer is torn down while the
  // server + tray keep running, and a subsequent Show recreates the window.
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
