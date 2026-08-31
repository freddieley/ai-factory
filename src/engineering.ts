import { z } from "zod";
import { randomUUID } from "node:crypto";

export const Requirement = z.object({
  id: z.string().default(() => `REQ-${randomUUID().slice(0, 8)}`),
  description: z.string().min(1),
  category: z.enum(["functional", "performance", "mechanical", "electrical", "manufacturing", "safety", "environmental", "cost", "other"]).default("other"),
  value: z.union([z.string(), z.number()]).optional(),
  unit: z.string().optional(),
  priority: z.enum(["must", "should", "could"]).default("should"),
  verificationMethod: z.string().optional(),
  verificationStatus: z.enum(["unverified", "pass", "fail"]).default("unverified")
});
export type Requirement = z.infer<typeof Requirement>;

export const EngineeringPlan = z.object({
  id: z.string().default(() => `PLAN-${randomUUID().slice(0, 8)}`),
  objective: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  requirements: z.array(Requirement).default([]),
  steps: z.array(z.object({
    id: z.string(), title: z.string(), description: z.string(),
    operationClass: z.enum(["read", "design", "modify", "export", "manufacture"]),
    requiresApproval: z.boolean()
  })).default([]),
  expectedVerification: z.array(z.string()).default([])
});
export type EngineeringPlan = z.infer<typeof EngineeringPlan>;

export function classifyOperation(operation: string) {
  const value = operation.toLowerCase();
  if (/(read|inspect|screenshot|search|recent|documentation)/.test(value)) return "read" as const;
  if (/(manufactur|machine|cnc|printer|toolpath|g-?code|dispatch|start job)/.test(value)) return "manufacture" as const;
  if (/(export|download|postprocess)/.test(value)) return "export" as const;
  if (/(create|modify|update|delete|move|extrude|sketch|feature|component|body)/.test(value)) return "modify" as const;
  return "design" as const;
}
