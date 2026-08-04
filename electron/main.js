"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell } = require("electron");
const { fork } = require("child_process");
const fs = require("fs");
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
  return path.join(__dirname, "..", "public", "icon.ico");
}

function createTray() {
  // Use nativeImage.createFromPath for reliable tray icon rendering on Windows
  const iconPath = path.join(__dirname, "tray-icon.png");
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon);
  tray.setToolTip("Pi Agent Web");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
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
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
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
    frame: false,
    backgroundColor: "#1a1a1a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Sync the renderer's document.title to the native window title,
  // so the workspace name (set by AppShell) appears in the title bar.
  mainWindow.webContents.on("page-title-updated", (_event, title) => {
    mainWindow.setTitle(title);
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

  mainWindow.loadURL(URL);

  mainWindow.on("close", (event) => {
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

  createTray();
  createWindow();
}

// ── Single-instance lock ──────────────────────────────────────
// Prevent multiple copies of the app from running at the same time.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to launch a second instance → restore the existing window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  // Remove the native menu bar for a clean frameless look.
  // DevTools can still be toggled via Ctrl+Shift+I / F12.
  Menu.setApplicationMenu(null);

  app.whenReady().then(bootstrap);
}

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
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
