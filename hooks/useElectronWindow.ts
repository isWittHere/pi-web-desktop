"use client";

import { useEffect, useState } from "react";

/**
 * Reflects the Electron shell window state when the app is running inside the
 * Electron desktop shell. In plain browser mode everything stays falsy and the
 * window controls are inert, so callers can branch on `isElectron` for free.
 */
export function useElectronWindow() {
  const [isElectron, setIsElectron] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const electron = typeof window !== "undefined" ? window.electron : undefined;
    if (!electron?.isElectron || !electron.windowControls) return;
    setIsElectron(true);

    let active = true;
    electron.windowControls
      .isMaximized()
      .then((maximized) => {
        if (active) setIsMaximized(maximized);
      })
      .catch(() => {});

    const unsubscribe = electron.windowControls.onMaximizedChange((maximized) => {
      if (active) setIsMaximized(maximized);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    isElectron,
    isMaximized,
    minimize: () => window.electron?.windowControls.minimize(),
    toggleMaximize: () => window.electron?.windowControls.toggleMaximize(),
    close: () => window.electron?.windowControls.close(),
  };
}