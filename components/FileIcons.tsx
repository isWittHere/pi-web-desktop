import type { CSSProperties, ReactNode } from "react";

interface IconProps {
  size?: number;
}

const ICON_ROOT = "/catppuccin-icons";

type IconStyle = CSSProperties & {
  "--catppuccin-icon-light": string;
  "--catppuccin-icon-dark": string;
};

function iconPath(flavor: "latte" | "mocha", icon: string) {
  return `url(${ICON_ROOT}/${flavor}/${icon}.svg)`;
}

function CatppuccinIcon({ icon, size = 14 }: IconProps & { icon: string }) {
  const style: IconStyle = {
    "--catppuccin-icon-light": iconPath("latte", icon),
    "--catppuccin-icon-dark": iconPath("mocha", icon),
    width: size,
    height: size,
  };

  return <span className="catppuccin-file-icon" style={style} aria-hidden="true" />;
}

const FOLDER_ICONS: Record<string, string> = {
  ".github": "github",
  ".git": "git",
  ".vscode": "vscode",
  ".next": "next",
  ".nuxt": "nuxt",
  ".storybook": "storybook",
  ".turbo": "turbo",
  ".yarn": "yarn",
  ".husky": "husky",
  ".cursor": "cursor",
  "api": "api",
  "app": "app",
  "assets": "assets",
  "components": "components",
  "config": "config",
  "docs": "docs",
  "examples": "examples",
  "hooks": "hooks",
  "lib": "lib",
  "node_modules": "node",
  "pages": "routes",
  "public": "public",
  "scripts": "scripts",
  "src": "src",
  "styles": "styles",
  "test": "tests",
  "tests": "tests",
  "__tests__": "tests",
  "types": "types",
  "utils": "utils",
};

/** Returns the Catppuccin folder icon for a directory, including its open state. */
export function FolderIcon({ size = 14, open = false, name }: IconProps & { open?: boolean; name?: string }) {
  const folderIcon = name ? FOLDER_ICONS[name.toLowerCase()] : undefined;
  const icon = folderIcon ? `folder_${folderIcon}${open ? "_open" : ""}` : `_${open ? "folder_open" : "folder"}`;
  return <CatppuccinIcon icon={icon} size={size} />;
}

/** Generic Catppuccin document icon used when no file association matches. */
export function GenericFileIcon({ size = 14 }: IconProps) {
  return <CatppuccinIcon icon="_file" size={size} />;
}

function FileIcon({ icon, size = 14 }: IconProps & { icon: string }) {
  return <CatppuccinIcon icon={icon} size={size} />;
}

const EXACT_FILE_ICONS: Record<string, string> = {
  ".babelrc": "babel",
  ".dockerignore": "docker-ignore",
  ".env": "env",
  ".eslintignore": "eslint-ignore",
  ".eslintrc": "eslint",
  ".gitattributes": "git",
  ".gitignore": "git",
  ".gitmodules": "git",
  ".npmignore": "npm-ignore",
  ".prettierignore": "prettier-ignore",
  ".prettierrc": "prettier",
  ".yarnrc": "yarn",
  "bun.lock": "bun-lock",
  "bun.lockb": "bun-lock",
  "cargo.lock": "cargo-lock",
  "cargo.toml": "cargo",
  "codeowners": "codeowners",
  "docker-compose.yaml": "docker-compose",
  "docker-compose.yml": "docker-compose",
  "dockerfile": "docker",
  "eslint.config.js": "eslint",
  "eslint.config.mjs": "eslint",
  "eslint.config.ts": "eslint",
  "next.config.js": "next",
  "next.config.mjs": "next",
  "next.config.ts": "next",
  "package-lock.json": "npm-lock",
  "package.json": "package-json",
  "pnpm-lock.yaml": "pnpm-lock",
  "pnpm-workspace.yaml": "pnpm",
  "prettier.config.js": "prettier",
  "prettier.config.mjs": "prettier",
  "prettier.config.ts": "prettier",
  "tailwind.config.js": "tailwind",
  "tailwind.config.ts": "tailwind",
  "tsconfig.json": "typescript-config",
  "vite.config.js": "vite",
  "vite.config.mjs": "vite",
  "vite.config.ts": "vite",
  "vitest.config.ts": "vitest",
  "yarn.lock": "yarn-lock",
};

const EXTENSION_ICONS: Record<string, string> = {
  "astro": "astro",
  "bash": "bash",
  "c": "c",
  "cpp": "cpp",
  "css": "css",
  "csv": "csv",
  "cjs": "javascript",
  "cts": "typescript",
  "dockerfile": "docker",
  "env": "env",
  "go": "go",
  "gql": "graphql",
  "graphql": "graphql",
  "hcl": "terraform",
  "htm": "html",
  "html": "html",
  "ini": "config",
  "java": "java",
  "js": "javascript",
  "json": "json",
  "jsonc": "json",
  "jsonl": "json",
  "jsx": "javascript-react",
  "less": "less",
  "lua": "lua",
  "md": "markdown",
  "mdx": "markdown-mdx",
  "mjs": "javascript",
  "mts": "typescript",
  "pdf": "pdf",
  "php": "php",
  "py": "python",
  "rs": "rust",
  "sass": "sass",
  "scss": "sass",
  "sh": "bash",
  "sql": "database",
  "svg": "svg",
  "svelte": "svelte",
  "tf": "terraform",
  "toml": "toml",
  "ts": "typescript",
  "tsx": "typescript-react",
  "txt": "text",
  "vue": "vue",
  "xml": "xml",
  "yaml": "yaml",
  "yml": "yaml",
  "zsh": "bash",
};

/**
 * Resolves a filename to its Catppuccin icon. The resolver is intentionally
 * shared by the file tree, @-mention completion, and opened-file tabs.
 */
export function getFileIcon(name: string, size = 14): ReactNode {
  const lower = name.toLowerCase();
  const exactIcon = EXACT_FILE_ICONS[lower];
  if (exactIcon) return <FileIcon icon={exactIcon} size={size} />;

  if (lower === ".env" || lower.startsWith(".env.")) return <FileIcon icon="env" size={size} />;
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return <FileIcon icon="docker" size={size} />;
  if (lower.endsWith(".config.ts") || lower.endsWith(".config.js") || lower.endsWith(".config.mjs") || lower.endsWith(".config.cjs")) {
    return <FileIcon icon={lower.startsWith("vite.") ? "vite" : "config"} size={size} />;
  }

  const extension = lower.split(".").pop() ?? "";
  const extensionIcon = EXTENSION_ICONS[extension];
  return extensionIcon ? <FileIcon icon={extensionIcon} size={size} /> : <GenericFileIcon size={size} />;
}
