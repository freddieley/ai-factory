import OpenAI from "openai";
import { z } from "zod";
import { addEvent } from "./db.js";
import { EngineeringPlan } from "./engineering.js";
import { getClient, providerInfo } from "./providers.js";

const PlannerResponse = z.object({
  objective: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  requirements: z.array(z.object({
    id: z.string().optional(),
    description: z.string(),
    category: z.enum(["functional", "performance", "mechanical", "electrical", "manufacturing", "safety", "environmental", "cost", "other"]),
    value: z.union([z.string(), z.number()]).optional(),
    unit: z.string().optional(),
    priority: z.enum(["must", "should", "could"]),
    verificationMethod: z.string().optional()
  })).default([]),
  steps: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    operationClass: z.enum(["read", "design", "modify", "export", "manufacture"]),
    requiresApproval: z.boolean()
  })).default([]),
  expectedVerification: z.array(z.string()).default([])
});

const SYSTEM = `You are the planning engineer for AI Factory, a civilian robotics and CAD engineering system.
Turn a user's engineering request into a concrete, conservative engineering plan.
Do not invent measurements that the user did not provide; put missing values in assumptions or make them explicit as assumptions.
Every modification must have a verification step. Manufacturing or physical machine execution must require human approval.
Return ONLY valid JSON matching the requested schema.`;

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Planner did not return a JSON object.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function createEngineeringPlan(projectId: string, prompt: string, runId: string) {
  const client = getClient();
  const info = providerInfo();
  const response = await client.chat.completions.create({
    model: info.model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Project: ${projectId}\nRequest:\n${prompt}\n\nSchema fields: objective, assumptions, requirements, steps, expectedVerification.` }
    ]
  });
  const content = response.choices[0]?.message?.content ?? "";
  const parsed = PlannerResponse.parse(extractJson(content));
  const plan = EngineeringPlan.parse(parsed);
  addEvent(runId, "engineering.plan.created", { plan });
  return plan;
}
