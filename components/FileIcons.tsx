// Flat monochrome file & folder icons — all use currentColor / var(--text-dim)

import {
  BracketsCurly,
  Code,
  Database,
  File,
  FileCode,
  FileDoc,
  FileHtml,
  FileJs,
  FilePdf,
  FilePy,
  FileRs,
  FileText,
  Folder,
  FolderOpen,
  Gear,
  GitBranch,
  Key,
  Lock,
  Terminal,
} from "@phosphor-icons/react";

interface IconProps {
  size?: number;
}

const DIM = "var(--text-dim)";

function iconStyle(size: number) {
  return { size, color: DIM, weight: "regular" as const, style: { display: "block", flexShrink: 0 } };
}

// ── Folder ────────────────────────────────────────────────────────────────

export function FolderIcon({ size = 14, open = false }: IconProps & { open?: boolean }) {
  const props = iconStyle(size);
  return open ? <FolderOpen {...props} /> : <Folder {...props} />;
}

// ── Generic file (fallback) ────────────────────────────────────────────────

export function GenericFileIcon({ size = 14 }: IconProps) {
  return <File {...iconStyle(size)} />;
}

// ── Specific icons ────────────────────────────────────────────────────────

export function TypeScriptIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function TypeScriptReactIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function JavaScriptIcon({ size = 14 }: IconProps) {
  return <FileJs {...iconStyle(size)} />;
}
export function JavaScriptReactIcon({ size = 14 }: IconProps) {
  return <FileJs {...iconStyle(size)} />;
}
export function PythonIcon({ size = 14 }: IconProps) {
  return <FilePy {...iconStyle(size)} />;
}
export function JsonIcon({ size = 14 }: IconProps) {
  return <BracketsCurly {...iconStyle(size)} />;
}
export function CssIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function ScssIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function HtmlIcon({ size = 14 }: IconProps) {
  return <FileHtml {...iconStyle(size)} />;
}
export function MarkdownIcon({ size = 14 }: IconProps) {
  return <FileText {...iconStyle(size)} />;
}
export function YamlIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function TomlIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function ShellIcon({ size = 14 }: IconProps) {
  return <Terminal {...iconStyle(size)} />;
}
export function RustIcon({ size = 14 }: IconProps) {
  return <FileRs {...iconStyle(size)} />;
}
export function GoIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function SqlIcon({ size = 14 }: IconProps) {
  return <Database {...iconStyle(size)} />;
}
export function GraphqlIcon({ size = 14 }: IconProps) {
  return <Code {...iconStyle(size)} />;
}
export function TerraformIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function DockerfileIcon({ size = 14 }: IconProps) {
  return <FileCode {...iconStyle(size)} />;
}
export function EnvIcon({ size = 14 }: IconProps) {
  return <Key {...iconStyle(size)} />;
}
export function GitIcon({ size = 14 }: IconProps) {
  return <GitBranch {...iconStyle(size)} />;
}
export function LockFileIcon({ size = 14 }: IconProps) {
  return <Lock {...iconStyle(size)} />;
}
export function DocFileIcon({ size = 14 }: IconProps) {
  return <FileDoc {...iconStyle(size)} />;
}
export function PdfFileIcon({ size = 14 }: IconProps) {
  return <FilePdf {...iconStyle(size)} />;
}
export function ConfigIcon({ size = 14 }: IconProps) {
  return <Gear {...iconStyle(size)} />;
}

// ── Main resolver ─────────────────────────────────────────────────────────

export function getFileIcon(name: string, size = 14): React.ReactNode {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";

  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return <DockerfileIcon size={size} />;
  if (lower === ".env" || lower.startsWith(".env.")) return <EnvIcon size={size} />;
  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".gitmodules") return <GitIcon size={size} />;
  if (lower === "package-lock.json" || lower === "yarn.lock" || lower === "bun.lock" || lower === "pnpm-lock.yaml" || lower === "cargo.lock") return <LockFileIcon size={size} />;
  if (lower.endsWith(".config.ts") || lower.endsWith(".config.js") || lower.endsWith(".config.mjs") || lower.endsWith(".config.cjs")) return <ConfigIcon size={size} />;
  if ([".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.mjs", "eslint.config.js"].includes(lower)) return <ConfigIcon size={size} />;

  switch (ext) {
    case "ts":      return <TypeScriptIcon size={size} />;
    case "tsx":     return <TypeScriptReactIcon size={size} />;
    case "js":
    case "mjs":
    case "cjs":     return <JavaScriptIcon size={size} />;
    case "jsx":     return <JavaScriptReactIcon size={size} />;
    case "py":      return <PythonIcon size={size} />;
    case "json":
    case "jsonl":   return <JsonIcon size={size} />;
    case "css":
    case "less":    return <CssIcon size={size} />;
    case "scss":    return <ScssIcon size={size} />;
    case "html":
    case "htm":     return <HtmlIcon size={size} />;
    case "md":
    case "mdx":     return <MarkdownIcon size={size} />;
    case "yaml":
    case "yml":     return <YamlIcon size={size} />;
    case "toml":    return <TomlIcon size={size} />;
    case "sh":
    case "bash":
    case "zsh":
    case "fish":    return <ShellIcon size={size} />;
    case "rs":      return <RustIcon size={size} />;
    case "go":      return <GoIcon size={size} />;
    case "sql":     return <SqlIcon size={size} />;
    case "graphql":
    case "gql":     return <GraphqlIcon size={size} />;
    case "tf":
    case "hcl":     return <TerraformIcon size={size} />;
    case "docx":    return <DocFileIcon size={size} />;
    case "pdf":     return <PdfFileIcon size={size} />;
    case "lock":    return <LockFileIcon size={size} />;
    default:          return <GenericFileIcon size={size} />;
  }
}
