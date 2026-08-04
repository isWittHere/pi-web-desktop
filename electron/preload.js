"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
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
});
