import { classifyOperation } from "./engineering.js";
export type PolicyDecision = { allowed: boolean; requiresApproval: boolean; reason: string; operationClass: ReturnType<typeof classifyOperation> };
const MANUFACTURING_PATTERNS = ["machine","manufacture","print","cnc","toolpath","g-code","gcode","dispatch","start job","run job"];
export function evaluateFusionOperation(toolName: string, args: Record<string, unknown>): PolicyDecision {
  const serialized = JSON.stringify({ toolName, args }).toLowerCase();
  const operationClass = classifyOperation(serialized);
  if (MANUFACTURING_PATTERNS.some(p => serialized.includes(p))) return { allowed:true, requiresApproval:true, operationClass:"manufacture", reason:"Physical manufacturing or machine execution requires explicit human approval." };
  if (operationClass === "export") return { allowed:true, requiresApproval:false, operationClass, reason:"Export is permitted in v1 but is recorded in the audit log." };
  return { allowed:true, requiresApproval:false, operationClass, reason:"CAD operation is permitted and will be recorded." };
}
