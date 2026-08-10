"use client";

import { useSyncExternalStore } from "react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import GoogleColorIcon from "@lobehub/icons/es/Google/components/Color";
import GoogleIcon from "@lobehub/icons/es/Google/components/Mono";
import DeepSeekColorIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MistralColorIcon from "@lobehub/icons/es/Mistral/components/Color";
import MistralIcon from "@lobehub/icons/es/Mistral/components/Mono";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import MinimaxColorIcon from "@lobehub/icons/es/Minimax/components/Color";
import FireworksColorIcon from "@lobehub/icons/es/Fireworks/components/Color";
import HuggingFaceColorIcon from "@lobehub/icons/es/HuggingFace/components/Color";
import CerebrasColorIcon from "@lobehub/icons/es/Cerebras/components/Color";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import CloudflareColorIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import AwsColorIcon from "@lobehub/icons/es/Aws/components/Color";
import AzureColorIcon from "@lobehub/icons/es/Azure/components/Color";
import AzureIcon from "@lobehub/icons/es/Azure/components/Mono";
import KimiColorIcon from "@lobehub/icons/es/Kimi/components/Color";
import QwenColorIcon from "@lobehub/icons/es/Qwen/components/Color";
import ZhipuColorIcon from "@lobehub/icons/es/Zhipu/components/Color";
import CohereColorIcon from "@lobehub/icons/es/Cohere/components/Color";
import PerplexityColorIcon from "@lobehub/icons/es/Perplexity/components/Color";
import TogetherColorIcon from "@lobehub/icons/es/Together/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import AntGroupColorIcon from "@lobehub/icons/es/AntGroup/components/Color";
import NvidiaColorIcon from "@lobehub/icons/es/Nvidia/components/Color";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import XiaomiMiMoIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import ZAIIcon from "@lobehub/icons/es/ZAI/components/Mono";
import CodexIcon from "@lobehub/icons/es/Codex/components/Mono";
import BedrockIcon from "@lobehub/icons/es/Bedrock/components/Mono";
import {
  getProviderIconMode,
  getProviderIconModesVersion,
  resolveProviderIconSource,
  subscribeProviderIconModes,
  type ProviderIconMode,
} from "@/lib/provider-icon";

type IconComponent = ComponentType<{ size?: number | string; style?: CSSProperties }>;

const PROVIDER_ICONS: Record<string, { Icon: IconComponent; hasColor: boolean }> = {
  anthropic: { Icon: AnthropicIcon, hasColor: false }, openai: { Icon: OpenAIIcon, hasColor: false }, "openai-codex": { Icon: OpenAIIcon, hasColor: false }, reqtoken: { Icon: OpenAIIcon, hasColor: false },
  google: { Icon: GoogleColorIcon, hasColor: true }, "google-vertex": { Icon: GoogleColorIcon, hasColor: true }, "ant-ling": { Icon: AntGroupColorIcon, hasColor: true },
  deepseek: { Icon: DeepSeekColorIcon, hasColor: true }, groq: { Icon: GroqIcon, hasColor: false }, mistral: { Icon: MistralColorIcon, hasColor: true },
  moonshotai: { Icon: MoonshotIcon, hasColor: false }, "moonshotai-cn": { Icon: MoonshotIcon, hasColor: false }, moonshot: { Icon: MoonshotIcon, hasColor: false },
  minimax: { Icon: MinimaxColorIcon, hasColor: true }, "minimax-cn": { Icon: MinimaxColorIcon, hasColor: true }, fireworks: { Icon: FireworksColorIcon, hasColor: true },
  huggingface: { Icon: HuggingFaceColorIcon, hasColor: true }, cerebras: { Icon: CerebrasColorIcon, hasColor: true }, openrouter: { Icon: OpenRouterIcon, hasColor: false },
  xai: { Icon: XAIIcon, hasColor: false }, "cloudflare-ai-gateway": { Icon: CloudflareColorIcon, hasColor: true }, "cloudflare-workers-ai": { Icon: CloudflareColorIcon, hasColor: true },
  "vercel-ai-gateway": { Icon: VercelIcon, hasColor: false }, "github-copilot": { Icon: GithubCopilotIcon, hasColor: false }, "amazon-bedrock": { Icon: AwsColorIcon, hasColor: true },
  "azure-openai-responses": { Icon: AzureColorIcon, hasColor: true }, "kimi-coding": { Icon: KimiColorIcon, hasColor: true }, nvidia: { Icon: NvidiaColorIcon, hasColor: true },
  opencode: { Icon: OpenCodeIcon, hasColor: false }, "opencode-go": { Icon: OpenCodeIcon, hasColor: false }, qwen: { Icon: QwenColorIcon, hasColor: true },
  xiaomi: { Icon: XiaomiMiMoIcon, hasColor: false }, "xiaomi-token-plan-ams": { Icon: XiaomiMiMoIcon, hasColor: false }, "xiaomi-token-plan-cn": { Icon: XiaomiMiMoIcon, hasColor: false }, "xiaomi-token-plan-sgp": { Icon: XiaomiMiMoIcon, hasColor: false },
  zai: { Icon: ZAIIcon, hasColor: false }, "zai-coding-cn": { Icon: ZAIIcon, hasColor: false }, zhipu: { Icon: ZhipuColorIcon, hasColor: true },
  cohere: { Icon: CohereColorIcon, hasColor: true }, perplexity: { Icon: PerplexityColorIcon, hasColor: true }, together: { Icon: TogetherColorIcon, hasColor: true }, grok: { Icon: GrokIcon, hasColor: false },
};

/**
 * Representative brand icon per API type — used when a provider has no
 * preset logo (auto fallback) or when the "api" mode is selected.
 * All variants render monochrome (currentColor) so the corner badge
 * can match their color exactly.
 */
const API_TYPE_ICONS: Record<string, { Icon: IconComponent; hasColor: boolean }> = {
  "openai-completions": { Icon: OpenAIIcon, hasColor: false },
  "openai-responses": { Icon: OpenAIIcon, hasColor: false },
  "openai-codex-responses": { Icon: CodexIcon, hasColor: false },
  "azure-openai-responses": { Icon: AzureIcon, hasColor: false },
  "anthropic-messages": { Icon: AnthropicIcon, hasColor: false },
  "google-generative-ai": { Icon: GoogleIcon, hasColor: false },
  "google-vertex": { Icon: GoogleIcon, hasColor: false },
  "mistral-conversations": { Icon: MistralIcon, hasColor: false },
  "bedrock-converse-stream": { Icon: BedrockIcon, hasColor: false },
  "pi-messages": { Icon: PiMessagesIcon, hasColor: false },
};

/** Pi logo — bundled svg is currentColor-based so it follows the theme. */
function PiMessagesIcon({ size, style }: { size?: number | string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ flex: "none", lineHeight: 1, ...style }}
      aria-hidden="true"
    >
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z" />
      <path fill="currentColor" d="M17.5 12H23v11h-5.5V12z" />
    </svg>
  );
}

/**
 * Bottom-right corner badge carrying the API-type letter.
 * Border and letter use currentColor so they always match the
 * monochrome API-type icon they are attached to.
 */
function CornerBadge({ letter, size }: { letter: string; size: number }) {
  const badge = Math.max(7, Math.round(size * 0.58));
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        right: -1,
        bottom: -1,
        minWidth: badge,
        height: badge,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 1px",
        boxSizing: "border-box",
        borderRadius: Math.max(2, Math.round(size * 0.15)),
        background: "var(--bg-panel)",
        border: "1px solid currentColor",
        color: "currentColor",
        fontSize: Math.max(5, Math.round(size * 0.4)),
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        lineHeight: 1,
        pointerEvents: "none",
      }}
    >
      {letter}
    </span>
  );
}

/** Letter badge: transparent rounded square with the provider's first char. */
function LetterBadge({ letter, size }: { letter: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        borderRadius: Math.max(3, Math.round(size * 0.28)),
        border: "1px solid currentColor",
        color: "currentColor",
        fontSize: Math.max(6, Math.round(size * 0.55)),
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

function useProviderIconMode(providerId: string) {
  useSyncExternalStore(subscribeProviderIconModes, getProviderIconModesVersion, () => 0);
  return getProviderIconMode(providerId);
}

/**
 * Renders a provider's logo, falling back to an API-type representative
 * icon, a letter badge, or a neutral CPU icon. The per-provider display
 * mode ("auto" | "api" | "letter") is user-configurable in ModelsConfig;
 * an explicit `mode` prop overrides the stored setting (used for previews).
 * Preset providers keep their plain logo in auto mode; the API-type
 * corner badge only appears for fallback icons or the forced "api" mode.
 */
export function ProviderIcon({ id, api, size = 14, mode }: { id: string; api?: string | null; size?: number; mode?: ProviderIconMode }) {
  const storedMode = useProviderIconMode(id);
  const source = resolveProviderIconSource(id, api, mode ?? storedMode, id in PROVIDER_ICONS);

  if (source.type === "letter") {
    return (
      <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, width: size, height: size }}>
        <LetterBadge letter={source.letter} size={size} />
      </span>
    );
  }

  let icon: ReactNode = null;
  if (source.type === "provider-logo") {
    const entry = PROVIDER_ICONS[id];
    icon = entry.hasColor
      ? <entry.Icon size={size} />
      : <entry.Icon size={size} style={{ color: "currentColor" }} />;
  } else if (source.type === "api-logo") {
    const entry = API_TYPE_ICONS[source.api];
    icon = entry
      ? (entry.hasColor
        ? <entry.Icon size={size} />
        : <entry.Icon size={size} style={{ color: "currentColor" }} />)
      : <CpuIcon size={size} weight="regular" aria-hidden="true" />;
  } else {
    icon = <CpuIcon size={size} weight="regular" aria-hidden="true" />;
  }

  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, width: size, height: size }}>
      {icon}
      {source.type === "api-logo" && <CornerBadge letter={source.badge} size={size} />}
    </span>
  );
}
