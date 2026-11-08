// Static facts about the BYOK providers, shared by the settings UI and the server. Capabilities are
// what the provider can serve; OpenRouter's depend on the chosen model. BytePlus (ModelArk, Seedance)
// and Kling are video only, reached over their own task APIs instead of the AI SDK.

export const AI_PROVIDERS = ["openai", "anthropic", "gemini", "openrouter", "byteplus", "kling"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
export const isAiProvider = (value: unknown): value is AiProviderId => (AI_PROVIDERS as readonly unknown[]).includes(value);

export const CAPABILITIES = ["chat", "tools", "vision", "imageGen", "imageEdit", "videoGen"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const PROVIDER_INFO: Record<AiProviderId, { capabilities: readonly Capability[]; keyPrefix: string; consoleUrl: string }> = {
  openai: { capabilities: ["chat", "tools", "vision", "imageGen", "imageEdit"], keyPrefix: "sk-", consoleUrl: "https://platform.openai.com/api-keys" },
  anthropic: { capabilities: ["chat", "tools", "vision"], keyPrefix: "sk-ant-", consoleUrl: "https://console.anthropic.com/settings/keys" },
  gemini: { capabilities: ["chat", "tools", "vision", "imageGen", "imageEdit", "videoGen"], keyPrefix: "AIza", consoleUrl: "https://aistudio.google.com/apikey" },
  openrouter: { capabilities: ["chat", "tools", "vision"], keyPrefix: "sk-or-", consoleUrl: "https://openrouter.ai/settings/keys" },
  byteplus: { capabilities: ["videoGen"], keyPrefix: "", consoleUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey" },
  kling: { capabilities: ["videoGen"], keyPrefix: "", consoleUrl: "https://kling.ai/dev" },
};

/** Which capability each app feature needs, for the coverage table. */
export const FEATURE_NEEDS = {
  create: "imageGen",
  video: "videoGen",
  generate: "imageGen",
  recolor: "imageEdit",
  aplus: "imageGen",
  looks: "imageGen",
  copy: "chat",
} as const satisfies Record<string, Capability>;

export type KeyStatus = "valid" | "invalid";
export type KeyError = "invalid_key" | "no_credits" | "rate_limited" | "provider_error" | "unreachable";
