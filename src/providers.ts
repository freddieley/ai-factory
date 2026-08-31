import OpenAI from "openai";
import { config } from "./config.js";

export type ProviderName = "local" | "fireworks";

export function providerInfo() {
  if (config.AI_PROVIDER === "local") {
    return { provider: "local" as const, model: config.LOCAL_MODEL, baseURL: config.LOCAL_BASE_URL };
  }
  return { provider: "fireworks" as const, model: config.FIREWORKS_MODEL, baseURL: config.FIREWORKS_BASE_URL };
}

export function getClient() {
  if (config.AI_PROVIDER === "local") {
    return new OpenAI({
      baseURL: config.LOCAL_BASE_URL,
      apiKey: config.LOCAL_API_KEY
    });
  }

  return new OpenAI({
    baseURL: config.FIREWORKS_BASE_URL,
    apiKey: config.FIREWORKS_API_KEY
  });
}
