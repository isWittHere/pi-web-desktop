import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Next.js may load next.config as ESM, where `__dirname` is undefined. Resolve
// the config directory from import.meta.url instead (upstream 0475e14).
const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  outputFileTracingRoot: configDir,
  // Turbopack is the default bundler in Next 16. A custom `webpack` config
  // without a `turbopack` config makes `next build` error out, so declare an
  // empty turbopack config to re-enable the default (Turbopack) build path.
  // The `webpack` function below remains for `npm run build:webpack`.
  turbopack: {},
  // The Electron window and dev tooling talk to the server on loopback;
  // Next's dev origin check must allow it (upstream 1e20164). Kept loopback-
  // only to preserve the desktop server's network boundary.
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "undici",
  ],
  // next 16.3's webpack no longer maps `node:`-prefixed builtins to externals
  // (undici's mock modules require('node:console')), which broke webpack dev.
  // Keep node: scheme imports external on the server; turbopack handles them natively.
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : []),
        ({ request }: { request?: string }, callback: (err?: Error | null, result?: string) => void) => {
          if (request && request.startsWith("node:")) return callback(null, `commonjs ${request}`);
          callback();
        }];
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },

    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
