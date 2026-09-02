import { createHash } from "node:crypto";
import { z } from "zod";
import { ElectronicsArchitecture } from "./electronics.js";

const ParameterValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(ParameterValue),
  z.record(z.string(), ParameterValue),
]));

export const RobotGeometryOperation = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  op: z.enum(["sketch","line","arc","circle","rectangle","polygon","spline","extrude","revolve","loft","sweep","boolean_union","boolean_cut","boolean_intersect","fillet","chamfer","shell","pattern","transform","mirror","datum"]),
  inputs: z.array(z.string().min(1)).default([]),
  parameters: z.record(z.string(), ParameterValue).default({}),
});
export type RobotGeometryOperation = z.infer<typeof RobotGeometryOperation>;

export const RobotPart = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/), name: z.string().min(1), material: z.string().min(1), manufacturingProcess: z.string().min(1),
  geometry: z.object({ schema: z.literal("ai-factory.robot-geometry/v1"), units: z.literal("mm"), operations: z.array(RobotGeometryOperation).min(1), outputOperationId: z.string().min(1) }),
  massKg: z.number().finite().positive().optional(),
});
export type RobotPart = z.infer<typeof RobotPart>;

export const RobotJoint = z.object({ id: z.string().min(1), parentPartId: z.string().min(1), childPartId: z.string().min(1), type: z.enum(["fixed","revolute","prismatic","spherical","planar"]), parameters: z.record(z.string(), ParameterValue).default({}) });

export const RobotDesign = z.object({
  schema: z.literal("ai-factory.robot-design/v1"), name: z.string().min(1), mission: z.string().min(1),
  requirements: z.array(z.object({ id: z.string().min(1), description: z.string().min(1), category: z.enum(["functional","performance","mechanical","electrical","manufacturing","safety","environmental","cost","other"]), value: z.union([z.string(), z.number()]).optional(), unit: z.string().optional(), priority: z.enum(["must","should","could"]), verificationMethod: z.string().optional() })).min(1),
  parts: z.array(RobotPart).min(1), joints: z.array(RobotJoint).default([]), electronicsArchitecture: ElectronicsArchitecture.optional(), designRationale: z.array(z.string().min(1)).default([]), unresolvedQuestions: z.array(z.string().min(1)).default([]),
});
export type RobotDesign = z.infer<typeof RobotDesign>;

function assertUnique(values: string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`${label} identifiers must be unique.`); }

function assertAcyclic(operations: RobotGeometryOperation[], partId: string): void {
  const byId = new Map(operations.map(operation => [operation.id, operation]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Geometry operation graph for ${partId} contains a cycle at ${id}.`);
    if (visited.has(id)) return;
    const operation = byId.get(id); if (!operation) return;
    visiting.add(id); for (const input of operation.inputs) visit(input); visiting.delete(id); visited.add(id);
  };
  for (const operation of operations) visit(operation.id);
}

function assertOutputReachability(operations: RobotGeometryOperation[], outputOperationId: string, partId: string): void {
  const byId = new Map(operations.map(operation => [operation.id, operation]));
  const reachable = new Set<string>();
  const visit = (id: string): void => {
    if (reachable.has(id)) return;
    const operation = byId.get(id); if (!operation) return;
    reachable.add(id); for (const input of operation.inputs) visit(input);
  };
  visit(outputOperationId);
  let addedAlias = true;
  while (addedAlias) {
    addedAlias = false;
    for (const operation of operations) {
      if (reachable.has(operation.id) || !["rectangle", "circle"].includes(operation.op)) continue;
      if (operation.inputs.some(input => reachable.has(input))) {
        reachable.add(operation.id);
        addedAlias = true;
      }
    }
  }
  const disconnected = operations.filter(operation => {
    if (reachable.has(operation.id)) return false;
    if (operation.op !== "transform" || operation.inputs.length === 0 || !reachable.has(operation.inputs[0])) return true;
    const parameters = operation.parameters;
    const hasRotation = typeof parameters.rotationDeg === "number" || typeof parameters.rotateDeg === "number";
    const hasTranslation = typeof parameters.translateXmm === "number" && typeof parameters.translateYmm === "number" || typeof parameters.translateX === "number" && typeof parameters.translateY === "number";
    return !hasRotation && !hasTranslation;
  }).map(operation => operation.id);
  if (disconnected.length) throw new Error(`Geometry operation graph for ${partId} contains disconnected operations not contributing to outputOperationId ${outputOperationId}: ${disconnected.join(", ")}.`);
}

function normalizeScalarParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...parameters };
  if (normalized.widthMm === undefined && typeof normalized.width === "number") normalized.widthMm = normalized.width;
  if (normalized.heightMm === undefined && typeof normalized.height === "number") normalized.heightMm = normalized.height;
  if (normalized.radiusMm === undefined && typeof normalized.radius === "number") normalized.radiusMm = normalized.radius;
  if (normalized.centerX === undefined && normalized.centerY === undefined && typeof normalized.center === "string") {
    const [x, y] = normalized.center.split(",").map(value => Number(value.trim()));
    if (Number.isFinite(x) && Number.isFinite(y)) { normalized.centerX = x; normalized.centerY = y; }
  }
  if (normalized.centerX === undefined && normalized.centerY === undefined && typeof normalized.center === "number") {
    normalized.centerX = normalized.center; normalized.centerY = 0;
  }
  return normalized;
}

function normalizeOperationInputs(inputs: unknown): unknown[] {
  if (!Array.isArray(inputs)) return [];
  return inputs.flatMap(input => {
    if (typeof input === "string") return [input];
    if (input && typeof input === "object" && !Array.isArray(input) && typeof (input as Record<string, unknown>).id === "string") return [String((input as Record<string, unknown>).id)];
    return [];
  });
}

function transportVariants(text: string): string[] {
  const variants = new Set<string>([text]);
  const add = (candidate: string) => { if (candidate && candidate !== text) variants.add(candidate); };
  add(text.replace(/^"([\s\S]*)"$/u, "$1"));
  add(text.replace(/\\\"/g, '"'));
  add(text.replace(/\\\\/g, "\\"));
  add(text.replace(/\\\\/g, "\\").replace(/\\\"/g, '"'));
  add(text.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\\"/g, '"'));
  return [...variants];
}

export function parseRobotDesignTransport(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let text = value.trim();
  if (text.startsWith("```")) text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let candidates = [text];
  let lastError = "unknown JSON transport error";
  for (let depth = 0; depth < 8; depth++) {
    const next: string[] = [];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        if (typeof parsed === "string") next.push(parsed.trim());
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        for (const variant of transportVariants(candidate)) if (!next.includes(variant)) next.push(variant);
      }
    }
    candidates = [...new Set(next.filter(Boolean))].slice(0, 32);
    if (!candidates.length) break;
  }

  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    const fragment = text.slice(firstObject, lastObject + 1);
    for (const candidate of transportVariants(fragment)) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  throw new Error(`Robot design must be a JSON object (or a valid JSON-encoded object). The supplied string was not valid JSON. Parser detail: ${lastError}`);
}

function normalizeRobotDesignInput(input: unknown): unknown {
  const transported = parseRobotDesignTransport(input);
  if (!transported || typeof transported !== "object" || Array.isArray(transported)) return transported;
  const source = transported as Record<string, unknown>;
  const parts = Array.isArray(source.parts) ? source.parts.map(rawPart => {
    if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) return rawPart;
    const part = rawPart as Record<string, unknown>;
    const geometry = part.geometry;
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return part;
    const g = geometry as Record<string, unknown>;
    const operations = Array.isArray(g.operations) ? g.operations.map(rawOp => {
      if (!rawOp || typeof rawOp !== "object" || Array.isArray(rawOp)) return rawOp;
      const op = rawOp as Record<string, unknown>;
      return {
        ...op,
        inputs: normalizeOperationInputs(op.inputs),
        parameters: normalizeScalarParameters((op.parameters && typeof op.parameters === "object" && !Array.isArray(op.parameters)) ? op.parameters as Record<string, unknown> : {}),
      };
    }) : g.operations;
    return { ...part, geometry: { ...g, operations } };
  }) : source.parts;
  const normalizationNotes: string[] = [];
  const joints = Array.isArray(source.joints) ? source.joints.flatMap((rawJoint, index) => {
    if (!rawJoint || typeof rawJoint !== "object" || Array.isArray(rawJoint)) return [rawJoint];
    const joint = rawJoint as Record<string, unknown>;
    const partIds = Array.isArray(joint.partIds) ? joint.partIds.filter(value => typeof value === "string") : [];
    const parentPartId = joint.parentPartId ?? partIds[0];
    const childPartId = joint.childPartId ?? partIds[1];
    const id = typeof joint.id === "string" ? joint.id : `JOINT-${String(index + 1).padStart(3, "0")}`;
    const type = joint.type === "bolted" ? "fixed" : joint.type;
    if (typeof joint.partId === "string" && parentPartId === undefined && childPartId === undefined) {
      normalizationNotes.push(`Joint ${id} was omitted because robot-design/v1 assembly joints require both parentPartId and childPartId; single-part mount annotations are not assembly joints.`);
      return [];
    }
    return [{ ...joint, id, parentPartId, childPartId, type }];
  }) : source.joints;
  const designRationale = Array.isArray(source.designRationale)
    ? source.designRationale.map(item => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).description === "string") return String((item as Record<string, unknown>).description);
        return String(item);
      })
    : typeof source.designRationale === "string"
      ? [source.designRationale]
      : source.designRationale;
  const unresolvedQuestions = Array.isArray(source.unresolvedQuestions)
    ? source.unresolvedQuestions.map(item => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const candidate = item as Record<string, unknown>;
          if (typeof candidate.question === "string" && typeof candidate.assumption === "string") return `${candidate.question} Assumption: ${candidate.assumption}`;
          if (typeof candidate.question === "string") return candidate.question;
        }
        return String(item);
      })
    : typeof source.unresolvedQuestions === "string"
      ? [source.unresolvedQuestions]
      : [];
  return { ...source, parts, joints, designRationale, unresolvedQuestions: [...unresolvedQuestions, ...normalizationNotes] };
}

export function validateRobotDesign(input: unknown): RobotDesign {
  const design = RobotDesign.parse(normalizeRobotDesignInput(input));
  assertUnique(design.requirements.map(r => r.id), "Requirement"); assertUnique(design.parts.map(p => p.id), "Part"); assertUnique(design.joints.map(j => j.id), "Joint");
  const partIds = new Set(design.parts.map(p => p.id));
  for (const joint of design.joints) { if (!partIds.has(joint.parentPartId) || !partIds.has(joint.childPartId)) throw new Error(`Joint ${joint.id} references an unknown part.`); if (joint.parentPartId === joint.childPartId) throw new Error(`Joint ${joint.id} cannot connect a part to itself.`); }
  for (const part of design.parts) {
    const operationIds = part.geometry.operations.map(o => o.id); assertUnique(operationIds, `Geometry operation in ${part.id}`); const operationSet = new Set(operationIds);
    for (const operation of part.geometry.operations) for (const input of operation.inputs) if (!operationSet.has(input)) throw new Error(`Geometry operation ${operation.id} references unknown input ${input}.`);
    if (!operationSet.has(part.geometry.outputOperationId)) throw new Error(`Part ${part.id} outputOperationId references an unknown geometry operation.`);
    assertAcyclic(part.geometry.operations, part.id);
    assertOutputReachability(part.geometry.operations, part.geometry.outputOperationId, part.id);
  }
  return design;
}

export function canonicalRobotDesignJson(input: unknown): string {
  const design = validateRobotDesign(input);
  const normalized = { ...design, requirements: [...design.requirements].sort((a,b) => a.id.localeCompare(b.id)), parts: [...design.parts].sort((a,b) => a.id.localeCompare(b.id)).map(part => ({ ...part, geometry: { ...part.geometry, operations: [...part.geometry.operations].sort((a,b) => a.id.localeCompare(b.id)) } })), joints: [...design.joints].sort((a,b) => a.id.localeCompare(b.id)) };
  return JSON.stringify(normalized);
}
export function robotDesignHash(input: unknown): string { return createHash("sha256").update(canonicalRobotDesignJson(input)).digest("hex"); }
