import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

type ProviderDef = {
  label: string;
  /** Short note shown in the UI. */
  note: string;
  isConfigured: () => boolean;
  defaultModel: () => string;
  /** Suggested models for the picker; any model id can still be typed in. */
  suggestedModels: string[];
  model: (modelId: string) => Parameters<typeof import("ai").streamText>[0]["model"];
};

const env = (name: string) => process.env[name]?.trim() || undefined;

export const providers = {
  openrouter: {
    label: "OpenRouter",
    note: "One key, hundreds of models. Models ending in :free cost nothing.",
    isConfigured: () => !!env("OPENROUTER_API_KEY"),
    defaultModel: () => env("OPENROUTER_MODEL") ?? "meta-llama/llama-3.3-70b-instruct:free",
    suggestedModels: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "deepseek/deepseek-chat-v3.1:free",
      "google/gemini-2.0-flash-exp:free",
      "anthropic/claude-sonnet-5.5",
      "openai/gpt-4o-mini",
    ],
    model: (id) =>
      createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: env("OPENROUTER_API_KEY"),
        headers: { "X-Title": "Doc Intel Chat" },
      }).chatModel(id),
  },
  azure: {
    label: "Azure OpenAI",
    note: "Uses your Azure OpenAI deployment name as the model id.",
    isConfigured: () =>
      !!env("AZURE_OPENAI_API_KEY") &&
      !!(env("AZURE_OPENAI_RESOURCE_NAME") || env("AZURE_OPENAI_BASE_URL")),
    defaultModel: () => env("AZURE_OPENAI_DEPLOYMENT") ?? "gpt-4o-mini",
    suggestedModels: [],
    model: (id) =>
      createAzure({
        apiKey: env("AZURE_OPENAI_API_KEY"),
        resourceName: env("AZURE_OPENAI_RESOURCE_NAME"),
        baseURL: env("AZURE_OPENAI_BASE_URL"),
        apiVersion: env("AZURE_OPENAI_API_VERSION"),
      }).chat(id),
  },
  ollama: {
    label: "Ollama (local, free)",
    note: "Runs models on your machine. Install Ollama and `ollama pull llama3.2`.",
    isConfigured: () => !!env("OLLAMA_BASE_URL"),
    defaultModel: () => env("OLLAMA_MODEL") ?? "llama3.2",
    suggestedModels: ["llama3.2", "qwen2.5", "mistral", "phi4"],
    model: (id) =>
      createOpenAICompatible({
        name: "ollama",
        baseURL: `${env("OLLAMA_BASE_URL")!.replace(/\/$/, "")}/v1`,
      }).chatModel(id),
  },
  groq: {
    label: "Groq (free tier)",
    note: "Very fast open models with a free tier.",
    isConfigured: () => !!env("GROQ_API_KEY"),
    defaultModel: () => env("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
    suggestedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    model: (id) => createGroq({ apiKey: env("GROQ_API_KEY") })(id),
  },
  google: {
    label: "Google Gemini (free tier)",
    note: "Free tier via Google AI Studio API key.",
    isConfigured: () => !!env("GOOGLE_GENERATIVE_AI_API_KEY"),
    defaultModel: () => env("GOOGLE_MODEL") ?? "gemini-2.5-flash",
    suggestedModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
    model: (id) => createGoogleGenerativeAI({ apiKey: env("GOOGLE_GENERATIVE_AI_API_KEY") })(id),
  },
  anthropic: {
    label: "Anthropic Claude",
    note: "Claude models via the Anthropic API.",
    isConfigured: () => !!env("ANTHROPIC_API_KEY"),
    defaultModel: () => env("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
    suggestedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    model: (id) => createAnthropic({ apiKey: env("ANTHROPIC_API_KEY") })(id),
  },
  openai: {
    label: "OpenAI",
    note: "OpenAI platform API.",
    isConfigured: () => !!env("OPENAI_API_KEY"),
    defaultModel: () => env("OPENAI_MODEL") ?? "gpt-4o-mini",
    suggestedModels: ["gpt-4o-mini", "gpt-4o"],
    model: (id) => createOpenAI({ apiKey: env("OPENAI_API_KEY") }).chat(id),
  },
} satisfies Record<string, ProviderDef>;

export type ProviderId = keyof typeof providers;

export function isProviderId(id: string): id is ProviderId {
  return id in providers;
}

/** The provider used when the client doesn't pick one: DEFAULT_CHAT_PROVIDER, else the first configured. */
export function defaultProviderId(): ProviderId | undefined {
  const preferred = env("DEFAULT_CHAT_PROVIDER");
  if (preferred && isProviderId(preferred) && providers[preferred].isConfigured()) return preferred;
  return (Object.keys(providers) as ProviderId[]).find((id) => providers[id].isConfigured());
}

export function listProviders() {
  return (Object.keys(providers) as ProviderId[]).map((id) => {
    const p: ProviderDef = providers[id];
    return {
      id,
      label: p.label,
      note: p.note,
      configured: p.isConfigured(),
      defaultModel: p.defaultModel(),
      suggestedModels: p.suggestedModels,
    };
  });
}
