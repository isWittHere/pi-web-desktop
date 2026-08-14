/**
 * Wallpaper feature — a user-set background image behind the whole
 * workspace, dimmed by a scrim of the app background color.
 *
 * The full-window `.chat-wallpaper` layer (components/WallpaperLayer.tsx)
 * carries the image in an <img> child. <html> state driven by
 * useWallpaper:
 *
 *   data-wallpaper        "on" while enabled
 *   data-wallpaper-ready  "1" once the image has decoded (fade-in)
 *   --wallpaper-scrim     scrim opacity percentage string, e.g. "70%"
 *   data-wallpaper-input / -message / -panel
 *                         per-area effect mode: none | trans | blur
 *
 * The scrim paints the theme's `--bg` over the image at the user-chosen
 * opacity, so text keeps its contrast in both light and dark modes; no
 * theme variables are rewritten.
 *
 * The image itself is a data URL persisted in localStorage and rendered
 * into an <img src> — never into a CSS property: Chromium silently drops
 * CSS values above ~1MB, and a PNG photo data URL easily exceeds that.
 */

/** Scrim opacity range (%). Higher = more theme background, less wallpaper. */
export const WALLPAPER_SCRIM_MIN = 30;
export const WALLPAPER_SCRIM_MAX = 95;
export const WALLPAPER_SCRIM_DEFAULT = 70;

/** Downscale cap for the longest image edge (px) before storing. */
export const WALLPAPER_MAX_DIMENSION = 2560;

/**
 * Storage budget for the persisted data URL, in characters. The wallpaper
 * lives in localStorage (≈5MB quota) as base64, so every pixel counts:
 * PNG re-encodes losslessly and easily exceeds the quota for photos, while
 * JPEG stays small. fileToWallpaperDataUrl picks the first encoding that
 * fits — shrinking the image, then falling back to JPEG (when the image is
 * opaque). 3.9M chars leaves headroom for the other app settings.
 */
export const WALLPAPER_STORAGE_BUDGET = 3_900_000;

/** Accepted image MIME types. SVG is rejected (script/entity attack surface). */
export const WALLPAPER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** localStorage keys + the change event broadcast when the wallpaper changes. */
export const WALLPAPER_URL_KEY = "pi-wallpaper";
export const WALLPAPER_ENABLED_KEY = "pi-wallpaper-enabled";
export const WALLPAPER_SCRIM_KEY = "pi-wallpaper-scrim";
/** Per-area effect mode keys: "none" | "trans" | "blur". */
export const WALLPAPER_INPUT_MODE_KEY = "pi-wallpaper-input";
export const WALLPAPER_MESSAGE_MODE_KEY = "pi-wallpaper-message";
export const WALLPAPER_PANEL_MODE_KEY = "pi-wallpaper-panel";
/* Legacy keys, migrated once to the mode keys above. */
export const WALLPAPER_BLUR_KEY = "pi-wallpaper-blur";
export const WALLPAPER_BLUR_LEVEL_KEY = "pi-wallpaper-blur-level";
export const WALLPAPER_BLUR_INPUT_KEY = "pi-wallpaper-blur-input";
export const WALLPAPER_BLUR_MESSAGE_KEY = "pi-wallpaper-blur-message";
export const WALLPAPER_BLUR_PANEL_KEY = "pi-wallpaper-blur-panel";
export const WALLPAPER_TRANSLUCENCY_KEY = "pi-wallpaper-translucency";
export const WALLPAPER_CHANGED_EVENT = "pi-wallpaper-changed";

/**
 * Read the persisted wallpaper data URL. Safe on the server (returns "").
 * NOTE: the URL is rendered into an <img src> — never into a CSS property:
 * Chromium silently drops CSS values above ~1MB, so large PNG wallpapers
 * would be lost when written to a CSS variable.
 */
export function readStoredWallpaperUrl(): string {
  try {
    return localStorage.getItem(WALLPAPER_URL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function isSupportedWallpaperMime(type: string): boolean {
  return (WALLPAPER_MIME_TYPES as readonly string[]).includes(type);
}

/**
 * Resolve the effective MIME type. File.type can be empty on some systems
 * (Windows file dialogs occasionally omit it), so fall back to the file
 * extension before rejecting.
 */
export function inferWallpaperMime(fileName: string, type: string): string {
  if (isSupportedWallpaperMime(type)) return type;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return type;
}

export function clampWallpaperScrim(value: number): number {
  return Math.min(WALLPAPER_SCRIM_MAX, Math.max(WALLPAPER_SCRIM_MIN, Math.round(value)));
}

/**
 * Read a picked image file, downscale it and encode it as a data URL that
 * fits WALLPAPER_STORAGE_BUDGET, for localStorage persistence (keeps the
 * feature serverless; survives restarts in both browser and Electron).
 *
 * Encoding strategy, in order:
 *   1. original format at 2560px (JPEG also tries 1600/1024/800px);
 *   2. JPEG fallback at decreasing sizes — only when the image is opaque,
 *      since JPEG flattens transparency onto black.
 * PNG/WebP transparency is preserved as long as a small enough size fits.
 */
export async function fileToWallpaperDataUrl(file: File): Promise<string> {
  const mime = inferWallpaperMime(file.name, file.type);
  if (!isSupportedWallpaperMime(mime)) {
    throw new Error(`Unsupported wallpaper type: ${file.type || file.name}`);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    const drawScaled = (maxDim: number) => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };

    // Check alpha once (cheap sampling) so we never flatten a transparent
    // PNG/WebP onto a black JPEG background.
    drawScaled(WALLPAPER_MAX_DIMENSION);
    const hasAlpha =
      (mime === "image/png" || mime === "image/webp") &&
      hasTransparency(ctx, canvas.width, canvas.height);

    const attempts: Array<{ maxDim: number; mime: string; quality?: number }> = [];
    for (const d of mime === "image/jpeg" ? [WALLPAPER_MAX_DIMENSION, 1600, 1024, 800] : [WALLPAPER_MAX_DIMENSION, 1600]) {
      attempts.push({ maxDim: d, mime });
    }
    if (!hasAlpha) {
      for (const d of [WALLPAPER_MAX_DIMENSION, 1600, 1024, 800]) {
        attempts.push({ maxDim: d, mime: "image/jpeg", quality: d > 1024 ? 0.8 : 0.75 });
      }
    }

    for (const attempt of attempts) {
      drawScaled(attempt.maxDim);
      const dataUrl = attempt.quality !== undefined
        ? canvas.toDataURL(attempt.mime, attempt.quality)
        : canvas.toDataURL(attempt.mime);
      if (dataUrl.length <= WALLPAPER_STORAGE_BUDGET) return dataUrl;
    }
    throw new Error("Wallpaper image is too large to store");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = src;
  });
}

/** Sample the alpha channel — every 8th pixel is plenty to detect opacity. */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  if (w === 0 || h === 0) return false;
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 32) {
    if (data[i] < 250) return true;
  }
  return false;
}
