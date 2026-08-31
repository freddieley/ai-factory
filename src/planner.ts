import { z } from "zod";
import { addEvent } from "./db.js";
import { EngineeringPlan } from "./engineering.js";
import { getClient, providerInfo } from "./providers.js";

const RequirementCategory = z.enum(["functional", "performance", "mechanical", "electrical", "manufacturing", "safety", "environmental", "cost", "other"]);
const OperationClass = z.enum(["read", "design", "modify", "export", "manufacture"]);

const PlannerResponse = z.object({
  objective: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  requirements: z.array(z.union([
    z.string(),
    z.object({
      id: z.string().optional(),
      description: z.string(),
      category: RequirementCategory.default("other"),
      value: z.union([z.string(), z.number()]).optional(),
      unit: z.string().optional(),
      priority: z.enum(["must", "should", "could"]).default("should"),
      verificationMethod: z.string().optional()
    })
  ])).default([]),
  steps: z.array(z.union([
    z.string(),
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      operationClass: OperationClass,
      requiresApproval: z.boolean()
    })
  ])).default([]),
  expectedVerification: z.union([z.array(z.string()), z.string()]).default([])
});

const SYSTEM = `You are the planning engineer for AI Factory, a civilian robotics and CAD engineering system.
Turn the user's request into a concrete, conservative engineering plan.
Do not invent measurements. Prefer inspection before modification. Every modification must have verification.
Manufacturing or physical machine execution requires human approval.
Return ONLY valid JSON. Arrays may contain concise strings, but prefer structured objects for requirements and steps.
For requirements use objects with description, category, priority, and optional value, unit, verificationMethod.
For steps use objects with id, title, description, operationClass, and requiresApproval.`;

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Planner did not return a JSON object.");
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

function normalizePlan(raw: unknown) {
  const parsed = PlannerResponse.parse(raw);

  const requirements = parsed.requirements.map((item, index) => {
    if (typeof item !== "string") return item;
    return {
      id: `REQ-PLAN-${index + 1}`,
      description: item,
      category: "other" as const,
      priority: "should" as const
    };
  });

  const steps = parsed.steps.map((item, index) => {
    if (typeof item !== "string") return item;
    return {
      id: `step-${index + 1}`,
      title: item,
      description: item,
      operationClass: /inspect|read|search|screenshot/i.test(item) ? "read" as const : "design" as const,
      requiresApproval: /manufactur|machine|cnc|printer|toolpath|g-?code/i.test(item)
    };
  });

  const expectedVerification = typeof parsed.expectedVerification === "string"
    ? parsed.expectedVerification
        .split(/\r?\n|;|\u2022/)
        .map(s => s.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean)
    : parsed.expectedVerification;

  return EngineeringPlan.parse({
    ...parsed,
    requirements,
    steps,
    expectedVerification
  });
}

export async function createEngineeringPlan(projectId: string, prompt: string, runId: string) {
  const client = getClient();
  const info = providerInfo();
  const response = await client.chat.completions.create({
    model: info.model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Project: ${projectId}\nRequest:\n${prompt}\n\nReturn fields: objective, assumptions, requirements, steps, expectedVerification.`
      }
    ]
  });

  const plan = normalizePlan(extractJson(response.choices[0]?.message?.content ?? ""));
  addEvent(runId, "engineering.plan.created", { plan });
  return plan;
}
