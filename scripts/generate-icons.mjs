// Generates macOS raster assets from the vector sources in public/.
//
// Electron's nativeImage only accepts PNG/JPEG (not SVG), so the Dock icon
// and the macOS menu-bar (tray) icon are rendered here with sharp:
//   - public/icon.svg        -> public/icon-mac.png  (1024x1024, app/Dock icon)
//   - public/pi-original.svg -> electron/tray-icon-mac.png (32x32, black+alpha,
//     used as a template image so macOS renders it for light/dark menu bars)
//
// Run manually with `npm run icons`; `electron:build` runs it automatically.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function renderSvg(svgPath, pngPath, size) {
  await sharp(svgPath, { density: 96 })
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(pngPath);
  const meta = await sharp(pngPath).metadata();
  console.log(`[icons] ${path.relative(root, pngPath)}  ${meta.width}x${meta.height}`);
}

async function main() {
  await mkdir(path.join(root, "electron"), { recursive: true });

  // Application / Dock icon (1024px — macOS convention for app icons).
  await renderSvg(
    path.join(root, "public", "icon.svg"),
    path.join(root, "public", "icon-mac.png"),
    1024,
  );

  // Menu-bar (tray) icon: 32x32 black+alpha template image.
  await renderSvg(
    path.join(root, "public", "pi-original.svg"),
    path.join(root, "electron", "tray-icon-mac.png"),
    32,
  );
}

main().catch((err) => {
  console.error("[icons] failed:", err);
  process.exit(1);
});
