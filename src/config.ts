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
  KICAD_CLI_PATH: z.string().default("kicad-cli"),
  KICAD_WORKSPACE_ROOT: z.string().default("./data/kicad"),
  MAX_AGENT_STEPS: z.coerce.number().int().min(1).max(100).default(12),
  MAX_MODEL_CALLS: z.coerce.number().int().min(1).max(100).default(4),
  MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(1000).default(30),
  MAX_RUN_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(120_000),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  PLANNER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(20_000),
  TOOL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  TEMPERATURE: z.coerce.number().min(0).default(0.2),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_PATH: z.string().default("./data/factory.db")
});

export const config = schema.parse(process.env);

if (config.AI_PROVIDER === "fireworks" && !config.FIREWORKS_API_KEY) {
  console.warn("FIREWORKS_API_KEY is empty; cloud inference will fail until it is configured.");
}
