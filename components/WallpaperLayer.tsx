"use client";

import { useEffect, useState } from "react";
import { WALLPAPER_CHANGED_EVENT, readStoredWallpaperUrl } from "@/lib/wallpaper";

/**
 * The wallpaper <img> + scrim layer, covering the whole workspace window
 * (sidebar, chat column and right panel). Subscribes to the
 * wallpaper-changed broadcast (emitted by useWallpaper) and re-reads the
 * persisted data URL, so the image swaps live without remounting. The
 * URL is only read on the client (useEffect) — SSR and hydration stay
 * in sync.
 *
 * This layer also owns the fade-in gate: the img sets
 * data-wallpaper-ready once decoded, so the wallpaper appears at
 * startup without the settings panel ever being opened (useWallpaper
 * only handles change-time fades).
 */
export function WallpaperLayer() {
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    const sync = () => setUrl(readStoredWallpaperUrl());
    sync();
    window.addEventListener(WALLPAPER_CHANGED_EVENT, sync);
    return () => window.removeEventListener(WALLPAPER_CHANGED_EVENT, sync);
  }, []);

  return (
    <div className="chat-wallpaper" aria-hidden="true">
      {/* next/image is not usable here: the wallpaper is a local data URL
          that must not be routed through the image optimizer. */}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- data URL, not optimizer-routable
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={() => { document.documentElement.dataset.wallpaperReady = "1"; }}
          onError={() => { document.documentElement.dataset.wallpaperReady = "1"; }}
        />
      )}
    </div>
  );
}
