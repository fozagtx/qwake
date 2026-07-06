import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject, generateText } from "ai";
import { z } from "zod";

export const BTL_BASE_URL = "https://api.badtheorylabs.com/v1";
export const DEFAULT_BTL_MODEL = "deepseek-v4-flash";

export type BtlRuntimeConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export type BtlSummaryInput = {
  location: unknown;
  tier: string;
  summary: string;
  guidance: string;
  sourceGeneratedUtc: string;
  consideredEvents: number;
  topEvents: unknown[];
};

export type QwakeAgentIntent = "chat" | "location_check" | "active_hazards" | "unsupported";

export type QwakeAgentPlan = {
  intent: QwakeAgentIntent;
  locationQuery: string | null;
  scope: "global" | "united_states";
  includeWebContext: boolean;
  reply: string | null;
};

export type QwakeAgentReplyInput = {
  userText: string;
  intent: QwakeAgentIntent;
  toolResult: string;
};

const qwakeAgentPlanSchema = z.object({
  intent: z.enum(["chat", "location_check", "active_hazards", "unsupported"]),
  locationQuery: z.string().nullable(),
  scope: z.enum(["global", "united_states"]),
  includeWebContext: z.boolean(),
  reply: z.string().nullable(),
});

export function getBtlRuntimeConfig(): BtlRuntimeConfig | null {
  const apiKey = process.env.BTL_API_KEY;
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseURL: BTL_BASE_URL,
    model: DEFAULT_BTL_MODEL,
  };
}

export function requireBtlRuntimeConfig(): BtlRuntimeConfig {
  const config = getBtlRuntimeConfig();
  if (config === null) {
    throw new Error("BTL_API_KEY is required");
  }
  return config;
}

export function createBtlRuntimeClient(config = getBtlRuntimeConfig()) {
  if (config === null) {
    return null;
  }

  const provider = createOpenAICompatible({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    name: "btl",
  });

  return {
    model: provider.chatModel(config.model),
    modelId: config.model,
  };
}

type BtlRuntimeClient = NonNullable<ReturnType<typeof createBtlRuntimeClient>>;

async function runBtlRequest<T>(runtime: BtlRuntimeClient, request: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!isRetryableBtlError(error) || attempt === 2) {
        throw error;
      }
      await sleep(750 * (attempt + 1));
    }
  }

  throw lastError;
}

export async function planBtlAgentTurn(userText: string): Promise<QwakeAgentPlan> {
  const runtime = createBtlRuntimeClient();
  if (runtime === null) {
    throw new Error("BTL_API_KEY is required");
  }

  const { object } = await runBtlRequest(runtime, () =>
    generateObject({
      model: runtime.model,
      schema: qwakeAgentPlanSchema,
      system: [
        "You are Qwake, an earthquake safety messaging agent. Decide whether to answer directly or call live tools.",
        "Return only compact JSON. Do not use markdown.",
        'Schema: {"intent":"chat|location_check|active_hazards|unsupported","locationQuery":string|null,"scope":"global|united_states","includeWebContext":boolean,"reply":string|null}',
        "Use chat for greetings, casual messages, and questions about how Qwake works. Reply naturally and briefly.",
        "Use location_check only when the user asks to check a specific place/coordinates or gives their location. Extract the clean place only.",
        "Use active_hazards when the user asks what places were affected, where earthquakes happened, vulnerable areas, dangerous areas, or earthquakes today/now.",
        "Use unsupported for unrelated non-earthquake requests; briefly explain Qwake can help with live earthquake checks.",
        "Set includeWebContext true only when the user asks for news, latest advisories, sources, reports, web context, or more details.",
        "The word live can mean the user lives somewhere. If the user writes 'live <place>' or 'I live in <place>', treat <place> as the locationQuery and keep includeWebContext false unless they also ask for news/advisories.",
        "Users may type noisy text. Typos like 'eart5huake' can mean earthquake. Questions like 'which part did earthquake affect today' are active_hazards.",
        "Do not invent earthquake facts. Tool results will provide live earthquake data later.",
      ].join(" "),
      prompt: userText,
    }),
  );

  return normalizeAgentPlan(object);
}

export async function composeBtlAgentReply(input: QwakeAgentReplyInput): Promise<string> {
  const runtime = createBtlRuntimeClient();
  if (runtime === null) {
    throw new Error("BTL_API_KEY is required");
  }

  const { text } = await runBtlRequest(runtime, () =>
    generateText({
      model: runtime.model,
      system:
        "You are Qwake, an earthquake safety messaging agent. Write a concise text-message response using only the supplied live tool result. Do not predict earthquakes. Do not invent locations, counts, magnitudes, official guidance, or sources. Keep the answer readable and short.",
      prompt: JSON.stringify(input),
    }),
  );

  return text.trim() || input.toolResult;
}

export async function generateBtlRuntimeSummary(input: BtlSummaryInput): Promise<string | null> {
  const runtime = createBtlRuntimeClient();
  if (runtime === null) {
    return null;
  }

  const { text } = await runBtlRequest(runtime, () =>
    generateText({
      model: runtime.model,
      system:
        "You write concise earthquake safety text messages. Use only the supplied live data. Do not predict earthquakes. Do not invent locations, counts, magnitudes, or official instructions.",
      prompt: JSON.stringify(input),
    }),
  );

  return text.trim() || null;
}

export type BtlRuntimeCheckResult = {
  model: string;
  response: string;
};

export async function checkBtlRuntime(): Promise<BtlRuntimeCheckResult> {
  const runtime = createBtlRuntimeClient();
  if (runtime === null) {
    throw new Error("BTL_API_KEY is required for the BTL Runtime check");
  }

  const { text } = await runBtlRequest(runtime, () =>
    generateText({
      model: runtime.model,
      system: "You are a concise assistant.",
      prompt: "Say hello from my Runtime workspace.",
    }),
  );

  const content = text.trim();
  if (!content) {
    throw new Error("BTL Runtime returned an empty response");
  }

  return { model: runtime.modelId, response: content };
}

function normalizeAgentPlan(value: unknown): QwakeAgentPlan {
  if (typeof value !== "object" || value === null) {
    throw new Error("BTL Runtime agent plan was not an object");
  }

  const record = value as Record<string, unknown>;
  const intent = normalizeIntent(record.intent);
  return {
    intent,
    locationQuery: readNullableString(record.locationQuery),
    scope: record.scope === "united_states" ? "united_states" : "global",
    includeWebContext: record.includeWebContext === true,
    reply: readNullableString(record.reply),
  };
}

function normalizeIntent(value: unknown): QwakeAgentIntent {
  if (value === "chat" || value === "location_check" || value === "active_hazards" || value === "unsupported") {
    return value;
  }

  throw new Error("BTL Runtime agent plan returned an unknown intent");
}

function readNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRetryableBtlError(error: unknown): boolean {
  const status = readNumberProperty(error, "status") ?? readNumberProperty(error, "statusCode");
  return status === 429 || (status !== undefined && status >= 500);
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "number" ? property : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
