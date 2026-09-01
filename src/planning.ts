import { providerInfo, getClient } from "./providers.js";
import { EngineeringPlan } from "./engineering.js";
import { savePlan } from "./engineering-db.js";
import { withTimeout } from "./execution.js";
import { config } from "./config.js";

export const PLAN_SCHEMA = `{
  "id": "PLAN-xxxxxxxx",
  "objective": "short engineering objective",
  "assumptions": ["explicit assumption"],
  "requirements": [{
    "id": "REQ-xxxxxxxx",
    "description": "testable requirement",
    "category": "functional|performance|mechanical|electrical|manufacturing|safety|environmental|cost|other",
    "value": "optional string or number",
    "unit": "optional unit",
    "priority": "must|should|could",
    "verificationMethod": "how the requirement will be verified",
    "verificationStatus": "unverified"
  }],
  "steps": [{
    "id": "STEP-1",
    "title": "step title",
    "description": "concrete action",
    "operationClass": "read|design|modify|export|manufacture",
    "requiresApproval": false
  }],
  "expectedVerification": ["observable evidence required for completion"]
}`;

export function buildPlanningPrompt(objective: string, constraints: string[]) {
  return `You are the planning layer of a local autonomous engineering factory. Convert the user's plain-language project request into a conservative, testable engineering plan. Do not invent measurements that the user did not provide. Turn explicit constraints into requirements. Prefer deterministic verification. Manufacturing, physical actuation, irreversible export, or other consequential operations must require approval. Keep the plan minimal and executable by downstream tools.\n\nReturn ONLY valid JSON matching this shape:\n${PLAN_SCHEMA}\n\nUser objective:\n${objective}\n\nConstraints:\n${constraints.length ? constraints.map(c => `- ${c}`).join("\n") : "- None specified"}`;
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error("Planner returned no JSON object.");
}

export function parseEngineeringPlan(content: string) {
  return EngineeringPlan.parse(extractJson(content));
}

export async function generateEngineeringPlan(projectId: string, objective: string, constraints: string[]) {
  const info = providerInfo();
  const client = getClient();
  const response = await withTimeout(client.chat.completions.create({
    model: info.model,
    temperature: 0,
    messages: [
      { role: "system", content: "You produce strictly structured engineering plans. Safety and verification take priority over speed." },
      { role: "user", content: buildPlanningPrompt(objective, constraints) }
    ]
  }), config.MODEL_TIMEOUT_MS, "Engineering planning");
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Planner returned an empty response.");
  const plan = parseEngineeringPlan(content);
  savePlan(projectId, plan);
  return { plan, provider: info };
}
