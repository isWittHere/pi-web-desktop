"use client";

import { useEffect, useState } from "react";
import { WALLPAPER_CHANGED_EVENT, readStoredWallpaperUrl, resolveWallpaperUrl } from "@/lib/wallpaper";

/**
 * The wallpaper <img> + scrim layer, covering the whole workspace window
 * (sidebar, chat column and right panel). Subscribes to the
 * wallpaper-changed broadcast (emitted by useWallpaper) and re-reads the
 * persisted data URL, so the image swaps live without remounting. The
 * URL is only read on the client (useEffect) — SSR and hydration stay
 * in sync.
 *
 * Without a user image the active pi theme decides which built-in Monet
 * painting shows; a MutationObserver on html[data-theme] swaps the
 * painting when the theme changes.
 *
 * This layer also owns the fade-in gate: the img sets
 * data-wallpaper-ready once decoded, so the wallpaper appears at
 * startup without the settings panel ever being opened (useWallpaper
 * only handles change-time fades).
 */
export function WallpaperLayer() {
  const [url, setUrl] = useState<string>("");
  const [themeName, setThemeName] = useState<string>("");

  useEffect(() => {
    const sync = () => setUrl(readStoredWallpaperUrl());
    sync();
    window.addEventListener(WALLPAPER_CHANGED_EVENT, sync);
    // Follow the active theme so the default wallpaper swaps paintings.
    const applyTheme = () => setThemeName(document.documentElement.dataset.theme ?? "");
    applyTheme();
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener(WALLPAPER_CHANGED_EVENT, sync);
      mo.disconnect();
    };
  }, []);

  const src = resolveWallpaperUrl(url, themeName);

  return (
    <div className="chat-wallpaper" aria-hidden="true">
      {/* next/image is not usable here: the wallpaper is a local data URL
          that must not be routed through the image optimizer. */}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- data URL / static asset, not optimizer-routable
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={() => { document.documentElement.dataset.wallpaperReady = "1"; }}
          onError={() => { document.documentElement.dataset.wallpaperReady = "1"; }}
        />
      )}
    </div>
  );
}
