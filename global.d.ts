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

interface PiDesktopNotificationPayload {
  sessionId?: string;
  title: string;
  detail?: string;
  /** Popup display duration in seconds, or "forever" to keep it until dismissed. */
  duration?: string;
  /** CSS variable name → value (e.g. "--bg" → "#242424") so the popup matches the active theme. */
  cssVars?: Record<string, string>;
}

interface PiDesktopNotificationResult {
  shown: boolean;
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
    showNotification: (payload: PiDesktopNotificationPayload) => Promise<PiDesktopNotificationResult>;
    onNotificationNavigate: (callback: (sessionId: string) => void) => () => void;
  };
  // Bridge used by the standalone notification popup window
  piNotification?: {
    onData: (callback: (payload: PiDesktopNotificationPayload) => void) => () => void;
    onClicked: (sessionId?: string) => void;
    onDismiss: () => void;
    onHover: (hovering: boolean) => void;
  };
}