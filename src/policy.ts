import { classifyOperation } from "./engineering.js";

export type PolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  operationClass: ReturnType<typeof classifyOperation>;
  reason: string;
};

const MANUFACTURING = ["manufacture", "machine", "cnc", "printer", "toolpath", "g-code", "gcode", "dispatch", "start job", "run job"];

export function evaluateFusionOperation(toolName: string, args: Record<string, unknown>): PolicyDecision {
  const serialized = JSON.stringify({ toolName, args }).toLowerCase();
  const operationClass = classifyOperation(serialized);
  if (MANUFACTURING.some(term => serialized.includes(term))) {
    return { allowed: true, requiresApproval: true, operationClass: "manufacture", reason: "Physical manufacturing or machine execution requires explicit human approval." };
  }
  return { allowed: true, requiresApproval: false, operationClass, reason: operationClass === "export" ? "Export is permitted and audited." : "CAD operation is permitted and audited." };
}
