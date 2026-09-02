import { classifyOperation } from "./engineering.js";
export type PolicyDecision = { allowed: boolean; requiresApproval: boolean; reason: string; operationClass: ReturnType<typeof classifyOperation> };
const MANUFACTURING_PATTERNS = ["machine","manufacture","print","cnc","toolpath","g-code","gcode","dispatch","start job","run job"];
const DESIGN_ONLY_CAPABILITIES = new Set(["ai_factory_submit_robot_design"]);
const CAD_COMPILE_CAPABILITIES = new Set(["ai_factory_compile_robot_cad"]);
export function evaluateFusionOperation(toolName: string, args: Record<string, unknown>): PolicyDecision {
  const serialized = JSON.stringify({ toolName, args }).toLowerCase();
  const operationClass = classifyOperation(serialized);
  if (DESIGN_ONLY_CAPABILITIES.has(toolName)) return { allowed:true, requiresApproval:false, operationClass:"read", reason:"Model-authored design validation is analysis only and does not execute physical manufacturing." };
  if (CAD_COMPILE_CAPABILITIES.has(toolName)) return { allowed:true, requiresApproval:false, operationClass:"modify", reason:"Validated model-authored CAD is being compiled into the connected Fusion document; this is CAD authoring, not physical machine execution." };
  if (MANUFACTURING_PATTERNS.some(p => serialized.includes(p))) return { allowed:true, requiresApproval:true, operationClass:"manufacture", reason:"Physical manufacturing or machine execution requires explicit human approval." };
  if (operationClass === "export") return { allowed:true, requiresApproval:false, operationClass, reason:"Export is permitted in v1 but is recorded in the audit log." };
  return { allowed:true, requiresApproval:false, operationClass, reason:"CAD operation is permitted and will be recorded." };
}
