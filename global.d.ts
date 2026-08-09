// Ambient declarations for the Electron bridge exposed via preload.js.
// These are only present when the app runs inside the Electron shell;
// in plain browser mode the optional fields are undefined.

interface ElectronWindowControls {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
}

interface Window {
  electron?: {
    isElectron: true;
    platform: NodeJS.Platform;
    windowControls: ElectronWindowControls;
  };
  // Existing bridge from SessionSidebar (declared there too — merged here centrally)
  piDesktop?: {
    selectDirectory: () => Promise<string | null>;
    openThemeFolder: () => Promise<string>;
    openThemeDocs: () => Promise<void>;
    showItemInFolder: (fullPath: string) => Promise<boolean>;
    getPathForFile: (file: File) => string;
  };
}