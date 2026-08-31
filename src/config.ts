import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  AI_PROVIDER: z.enum(["local", "fireworks"]).default("local"),
  LOCAL_BASE_URL: z.string().default("http://127.0.0.1:11434/v1"),
  LOCAL_API_KEY: z.string().default("ollama"),
  LOCAL_MODEL: z.string().default("qwen3.5:9b-q4_K_M"),
  FIREWORKS_BASE_URL: z.string().default("https://api.fireworks.ai/inference/v1"),
  FIREWORKS_API_KEY: z.string().optional(),
  FIREWORKS_MODEL: z.string().default("accounts/fireworks/models/glm-5p2"),
  FUSION_MCP_URL: z.string().default("http://127.0.0.1:27182/mcp"),
  FUSION_MCP_ENABLED: z.coerce.boolean().default(true),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(50).default(12),
  TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_PATH: z.string().default("./data/factory.db")
});

export const config = schema.parse(process.env);

if (config.AI_PROVIDER === "fireworks" && !config.FIREWORKS_API_KEY) {
  console.warn("FIREWORKS_API_KEY is empty; cloud inference will fail until it is configured.");
}
