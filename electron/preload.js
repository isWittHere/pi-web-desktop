"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximizedChange: (callback) => {
      const listener = (_event, maximized) => callback(maximized);
      ipcRenderer.on("window:maximized-changed", listener);
      return () => ipcRenderer.removeListener("window:maximized-changed", listener);
    },
  },
});

// Desktop workspace picker bridge — native OS folder dialog.
contextBridge.exposeInMainWorld("piDesktop", {
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  openThemeFolder: () => ipcRenderer.invoke("shell:open-theme-folder"),
  openThemeDocs: () => ipcRenderer.invoke("shell:open-theme-docs"),
  // Reveal a file/folder in the system file explorer (used by context menus).
  showItemInFolder: (fullPath) => ipcRenderer.invoke("shell:show-item-in-folder", fullPath),
  // Absolute path of a dragged-in File (webUtils is the only sanctioned way
  // to recover paths from drop payloads since File.path was removed).
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // Screen-level completion notification popup (see electron/main.js).
  // Returns { shown: boolean } — false when the main window is focused or
  // the payload is invalid, so callers can decide on in-app fallback.
  showNotification: (payload) => ipcRenderer.invoke("notification:show", payload),
  // Clicking a notification card asks the renderer to select that session
  // (the main process already raised/focused the window).
  onNotificationNavigate: (callback) => {
    const listener = (_event, sessionId) => callback(sessionId);
    ipcRenderer.on("notification:navigate", listener);
    return () => ipcRenderer.removeListener("notification:navigate", listener);
  },
});

// Bridge used by the standalone notification popup window (loaded from
// electron/notification-window.html). The popup receives pushed content from
// the main process and reports clicks back; it never opens its own IPC.
contextBridge.exposeInMainWorld("piNotification", {
  onData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("notification:data", listener);
    return () => ipcRenderer.removeListener("notification:data", listener);
  },
  onClicked: (sessionId) => ipcRenderer.send("notification:clicked", sessionId),
  // Dismiss (×) button: hides the card without raising the main window.
  onDismiss: () => ipcRenderer.send("notification:dismiss"),
  // Hover state — the main process pauses/resumes the auto-hide timer.
  onHover: (hovering) => ipcRenderer.send("notification:hover", hovering),
});
