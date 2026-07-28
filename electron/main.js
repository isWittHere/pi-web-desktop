"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage } = require("electron");
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

const URL = `http://localhost:${PORT}`;

let mainWindow = null;
let serverProcess = null;
let tray = null;

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(`${URL}/api/home`, (res) => {
        res.resume();
        resolve();
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
    ? ["dev", "-p", String(PORT), "--turbopack"]
    : ["start", "-p", String(PORT)];

  const env = IS_DEV
    ? { ...process.env, ELECTRON_RUNNING: "1" }
    : { ...process.env, NODE_ENV: "production", ELECTRON_RUNNING: "1" };

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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:maximized-changed", mainWindow.isMaximized());
    }
  };
  mainWindow.on("maximize", sendMaximizedState);
  mainWindow.on("unmaximize", sendMaximizedState);

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

// Remove the native menu bar for a clean frameless look.
// DevTools can still be toggled via Ctrl+Shift+I / F12.
Menu.setApplicationMenu(null);

app.whenReady().then(bootstrap);

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
