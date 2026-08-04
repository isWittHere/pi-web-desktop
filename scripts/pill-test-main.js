// Temporary headless verification for the step-pill layout (never committed).
const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 400,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  win.webContents.on("console-message", (_e, _level, message) => {
    console.log(message);
  });
  await win.loadFile(path.join(__dirname, "pill-test.html"));
  setTimeout(() => app.exit(0), 1200);
});
