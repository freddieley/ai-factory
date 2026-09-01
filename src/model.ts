import OpenAI from "openai";
import { withTimeout } from "./execution.js";

export type ModelRequestOptions = {
  client: OpenAI;
  model: string;
  temperature: number;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  timeoutMs: number;
  retries: number;
  onRetry?: (attempt: number, error: unknown) => void;
};

function isRetryable(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("timed out") || message.includes("timeout") || message.includes("econnreset") || message.includes("econnrefused") || message.includes("503") || message.includes("502") || message.includes("429");
}

export async function requestModel(options: ModelRequestOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await withTimeout(
        options.client.chat.completions.create({
          model: options.model,
          temperature: options.temperature,
          messages: options.messages,
          tools: options.tools,
          tool_choice: "auto"
        }),
        options.timeoutMs,
        "Model request"
      );
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries || !isRetryable(error)) throw error;
      options.onRetry?.(attempt + 1, error);
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 2_000)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
