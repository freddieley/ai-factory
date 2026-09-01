import { z } from "zod";
import { addEvent } from "./db.js";
import { EngineeringPlan } from "./engineering.js";
import { getClient, providerInfo } from "./providers.js";

const PlannerResponse = z.object({
  objective: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  requirements: z.array(z.union([
    z.string(),
    z.object({
      id: z.union([z.string(), z.number()]).optional(), description: z.string(), category: z.string().default("other"),
      value: z.union([z.string(), z.number()]).optional(), unit: z.string().optional(), priority: z.string().default("should"), verificationMethod: z.string().optional()
    })
  ])).default([]),
  steps: z.array(z.union([
    z.string(),
    z.object({ id: z.union([z.string(), z.number()]), title: z.string(), description: z.string(), operationClass: z.string(), requiresApproval: z.boolean().optional().default(false) })
  ])).default([]),
  expectedVerification: z.union([z.array(z.string()), z.string()]).default([])
});

function mapCategory(value: string) {
  const v = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (v.includes("function")) return "functional";
  if (v.includes("performance") || v.includes("perform")) return "performance";
  if (v.includes("mechan") || v.includes("physical")) return "mechanical";
  if (v.includes("electr") || v.includes("power") || v.includes("circuit")) return "electrical";
  if (v.includes("manufact") || v.includes("fabricat")) return "manufacturing";
  if (v.includes("safety") || v.includes("secure") || v.includes("risk")) return "safety";
  if (v.includes("environment") || v.includes("weather") || v.includes("temperature")) return "environmental";
  if (v.includes("cost") || v.includes("budget")) return "cost";
  return "other";
}
function mapPriority(value: string): "must" | "should" | "could" {
  const v = value.trim().toLowerCase();
  if (/(critical|high|mandatory|required|must)/.test(v)) return "must";
  if (/(low|optional|nice|could)/.test(v)) return "could";
  return "should";
}
function mapOperationClass(value: string, text: string): "read" | "design" | "modify" | "export" | "manufacture" {
  const v = `${value} ${text}`.toLowerCase();
  if (/(manufactur|machine|cnc|printer|toolpath|g-?code|dispatch)/.test(v)) return "manufacture";
  if (/(export|download|postprocess)/.test(v)) return "export";
  if (/(inspect|read|search|screenshot|retrieve|analysis|analy[sz]e)/.test(v)) return "read";
  if (/(create|modify|update|delete|extrude|sketch|feature|component|body|edit)/.test(v)) return "modify";
  return "design";
}
function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text; const start = candidate.indexOf("{"); const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Planner did not return a JSON object.");
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

function normalizePlan(raw: unknown) {
  const parsed = PlannerResponse.parse(raw);
  const requirements = parsed.requirements.map((item, index) => typeof item === "string"
    ? { id: `REQ-PLAN-${index + 1}`, description: item, category: "other" as const, priority: "should" as const }
    : { ...item, id: item.id === undefined ? `REQ-PLAN-${index + 1}` : String(item.id), category: mapCategory(item.category), priority: mapPriority(item.priority) });
  const steps = parsed.steps.map((item, index) => typeof item === "string"
    ? { id: `step-${index + 1}`, title: item, description: item, operationClass: mapOperationClass("", item), requiresApproval: /manufactur|machine|cnc|printer|toolpath|g-?code|dispatch/i.test(item) }
    : { ...item, id: String(item.id), operationClass: mapOperationClass(item.operationClass, `${item.title} ${item.description}`), requiresApproval: item.requiresApproval || /manufactur|machine|cnc|printer|toolpath|g-?code|dispatch/i.test(`${item.title} ${item.description}`) });
  const expectedVerification = typeof parsed.expectedVerification === "string"
    ? parsed.expectedVerification.split(/\r?\n|;|\u2022/).map(s => s.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
    : parsed.expectedVerification;
  return EngineeringPlan.parse({ ...parsed, requirements, steps, expectedVerification });
}

const SYSTEM = `You are the planning engineer for AI Factory, a civilian robotics and CAD engineering system. Turn the user's request into a concrete, conservative engineering plan. Do not invent measurements. Prefer inspection before modification. Every modification must have verification. Manufacturing or physical machine execution requires human approval. Return ONLY valid JSON. Use structured requirement objects with description, category, priority and optional value/unit/verificationMethod. Use step objects with id, title, description, operationClass and requiresApproval.`;

export async function createEngineeringPlan(projectId: string, prompt: string, runId: string) {
  const client = getClient(); const info = providerInfo();
  const response = await client.chat.completions.create({ model: info.model, temperature: 0, messages: [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Project: ${projectId}\nRequest:\n${prompt}\n\nReturn fields: objective, assumptions, requirements, steps, expectedVerification.` }
  ] });
  const plan = normalizePlan(extractJson(response.choices[0]?.message?.content ?? ""));
  addEvent(runId, "engineering.plan.created", { plan });
  return plan;
}
