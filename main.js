"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const { spawn, fork } = require("child_process");
const path = require("path");
const http = require("http");

const PORT = process.env.PORT || 30141;
const IS_DEV = !app.isPackaged;
const URL = `http://localhost:${PORT}`;

let mainWindow = null;
let serverProcess = null;

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

  if (IS_DEV) {
    // Dev: process.execPath is node.exe — spawn works normally.
    const nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
    serverProcess = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT), "--turbopack"], {
      cwd: pkgDir,
      stdio: "inherit",
      env: { ...process.env, ELECTRON_RUNNING: "1" },
    });
  } else {
    // Production: process.execPath is Pi Web.exe (the Electron exe), not Node.
    // fork() spawns a new process using Electron's embedded Node.js runtime,
    // so the Next.js script runs as a plain Node child process.
    const nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
    serverProcess = fork(nextBin, ["start", "-p", String(PORT)], {
      cwd: pkgDir,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production", ELECTRON_RUNNING: "1" },
    });
  }

  serverProcess.on("exit", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    title: "Pi Agent Web",
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
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
