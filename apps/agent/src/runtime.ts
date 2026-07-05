import OpenAI from "openai";

export const BTL_BASE_URL = "https://api.badtheorylabs.com/v1";
export const DEFAULT_BTL_MODEL_CHAIN = ["deepseek-v4-flash"] as const;

export type BtlRuntimeConfig = {
  apiKey: string;
  baseURL: string;
  models: string[];
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
    models: getBtlModelChain(),
  };
}

export function getBtlModelChain(): string[] {
  const configuredChain = process.env.BTL_MODEL_CHAIN;
  if (configuredChain) {
    return configuredChain
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
  }

  if (process.env.BTL_MODEL) {
    return [process.env.BTL_MODEL];
  }

  return [...DEFAULT_BTL_MODEL_CHAIN];
}

export function requireBtlRuntimeConfig(): BtlRuntimeConfig {
  const config = getBtlRuntimeConfig();
  if (config === null) {
    throw new Error("BTL_API_KEY is required");
  }
  return config;
}

export function createBtlRuntimeClient(config = getBtlRuntimeConfig()):
  | { client: OpenAI; models: string[] }
  | null {
  if (config === null) {
    return null;
  }

  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }),
    models: config.models,
  };
}

export async function generateBtlRuntimeSummary(input: BtlSummaryInput): Promise<string | null> {
  const runtime = createBtlRuntimeClient();
  if (runtime === null) {
    return null;
  }

  for (const model of runtime.models) {
    try {
      const completion = await runtime.client.chat.completions.create({
        model,
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

      const content = completion.choices[0]?.message.content?.trim();
      if (content) {
        return content;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export type BtlRuntimeCheckResult = {
  model: string;
  response: string;
  failedModels: Array<{ model: string; error: string }>;
};

export async function checkBtlRuntime(): Promise<BtlRuntimeCheckResult> {
  const runtime = createBtlRuntimeClient();
  if (runtime === null) {
    throw new Error("BTL_API_KEY is required for the BTL Runtime check");
  }

  const failedModels: BtlRuntimeCheckResult["failedModels"] = [];
  for (const model of runtime.models) {
    try {
      const completion = await runtime.client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "Say hello from my Runtime workspace." }],
      });

      const content = completion.choices[0]?.message.content?.trim();
      if (!content) {
        failedModels.push({ model, error: "empty response" });
        continue;
      }

      return { model, response: content, failedModels };
    } catch (error) {
      failedModels.push({
        model,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  throw new Error(
    `All BTL Runtime models failed: ${failedModels
      .map((failure) => `${failure.model}: ${failure.error}`)
      .join("; ")}`,
  );
}
