// Static facts about the BYOK providers, shared by the settings UI and the server. Capabilities are
// what the provider can serve through the AI SDK; OpenRouter's depend on the chosen model.

export const AI_PROVIDERS = ["openai", "anthropic", "gemini", "openrouter"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
export const isAiProvider = (value: unknown): value is AiProviderId => (AI_PROVIDERS as readonly unknown[]).includes(value);

export const CAPABILITIES = ["chat", "tools", "vision", "imageGen", "imageEdit"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const PROVIDER_INFO: Record<AiProviderId, { capabilities: readonly Capability[]; keyPrefix: string; consoleUrl: string }> = {
  openai: { capabilities: ["chat", "tools", "vision", "imageGen", "imageEdit"], keyPrefix: "sk-", consoleUrl: "https://platform.openai.com/api-keys" },
  anthropic: { capabilities: ["chat", "tools", "vision"], keyPrefix: "sk-ant-", consoleUrl: "https://console.anthropic.com/settings/keys" },
  gemini: { capabilities: ["chat", "tools", "vision", "imageGen", "imageEdit"], keyPrefix: "AIza", consoleUrl: "https://aistudio.google.com/apikey" },
  openrouter: { capabilities: ["chat", "tools", "vision"], keyPrefix: "sk-or-", consoleUrl: "https://openrouter.ai/settings/keys" },
};

/** Which capability each app feature needs, for the coverage table. */
export const FEATURE_NEEDS = {
  generate: "imageGen",
  recolor: "imageEdit",
  aplus: "imageGen",
  looks: "imageGen",
  copy: "chat",
} as const satisfies Record<string, Capability>;

export type KeyStatus = "valid" | "invalid";
export type KeyError = "invalid_key" | "no_credits" | "rate_limited" | "provider_error" | "unreachable";
