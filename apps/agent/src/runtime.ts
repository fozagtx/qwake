import OpenAI from "openai";

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

export function getBtlRuntimeConfig(): BtlRuntimeConfig | null {
  const apiKey = process.env.BTL_API_KEY;
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseURL: BTL_BASE_URL,
    model: process.env.BTL_MODEL ?? DEFAULT_BTL_MODEL,
  };
}

export function requireBtlRuntimeConfig(): BtlRuntimeConfig {
  const config = getBtlRuntimeConfig();
  if (config === null) {
    throw new Error("BTL_API_KEY is required");
  }
  return config;
}

export function createBtlRuntimeClient(config = getBtlRuntimeConfig()):
  | { client: OpenAI; model: string }
  | null {
  if (config === null) {
    return null;
  }

  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }),
    model: config.model,
  };
}

export async function generateBtlRuntimeSummary(input: BtlSummaryInput): Promise<string | null> {
  const runtime = createBtlRuntimeClient();
  if (runtime === null) {
    return null;
  }

  const completion = await runtime.client.chat.completions.create({
    model: runtime.model,
    messages: [
      {
        role: "system",
        content:
          "You write concise earthquake safety text messages. Use only the supplied live data. Do not predict earthquakes. Do not invent locations, counts, magnitudes, or official instructions.",
      },
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ],
  });

  return completion.choices[0]?.message.content?.trim() || null;
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

  const completion = await runtime.client.chat.completions.create({
    model: runtime.model,
    messages: [{ role: "user", content: "Say hello from my Runtime workspace." }],
  });

  const content = completion.choices[0]?.message.content?.trim();
  if (!content) {
    throw new Error("BTL Runtime returned an empty response");
  }

  return { model: runtime.model, response: content };
}
