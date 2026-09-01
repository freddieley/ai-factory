import { z } from "zod";
import { ParametricModel, resolveLength } from "./parametric.js";
import { analyzeClearance, transformBox, type ClearanceResult } from "./geometry.js";

const positive = z.number().finite().positive();
const nonNegative = z.number().finite().nonnegative();
const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const quaternion = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);

export const MaterialSpec = z.object({
  material: z.string().min(1),
  densityKgM3: positive.optional(),
  maxServiceTempC: z.number().finite().optional(),
  supportedProcesses: z.array(z.string().min(1)).default([]),
});

export const ToleranceSpec = z.object({
  parameter: z.string().min(1),
  plusMm: nonNegative,
  minusMm: nonNegative,
});

export const CoordinateFrame = z.object({
  originMm: vector3.default([0, 0, 0]),
  rotationQuat: quaternion.default([0, 0, 0, 1]),
});

export const AssemblyPart = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  name: z.string().min(1),
  model: z.string().min(1),
  material: MaterialSpec.optional(),
  process: z.string().min(1).optional(),
  frame: CoordinateFrame.default({}),
  tolerances: z.array(ToleranceSpec).default([]),
});

export const Joint = z.object({
  id: z.string().min(1),
  type: z.enum(["fixed", "revolute", "prismatic", "ball", "cylindrical"]),
  parentPartId: z.string().min(1),
  childPartId: z.string().min(1),
  axes: z.array(z.enum(["x", "y", "z"])).min(1).default(["z"]),
  lowerLimit: z.number().finite().optional(),
  upperLimit: z.number().finite().optional(),
  limitUnit: z.enum(["deg", "mm"]).optional(),
});

export const Fastener = z.object({
  id: z.string().min(1),
  standard: z.string().min(1),
  size: z.string().min(1),
  quantity: z.number().int().positive(),
  partIds: z.array(z.string().min(1)).min(2),
  material: z.string().min(1).optional(),
});

export const ProcessCapability = z.object({
  process: z.string().min(1),
  minFeatureMm: nonNegative.default(0),
  toleranceMm: positive.optional(),
  maxPartMm: positive.optional(),
  materials: z.array(z.string().min(1)).default([]),
});

export const AssemblyModel = z.object({
  schema: z.literal("ai-factory.mechanical-assembly/v1"),
  name: z.string().min(1),
  units: z.literal("mm"),
  parts: z.array(AssemblyPart).min(1),
  joints: z.array(Joint).default([]),
  fasteners: z.array(Fastener).default([]),
  processCapabilities: z.array(ProcessCapability).default([]),
});

export type AssemblyModel = z.infer<typeof AssemblyModel>;
export type ManufacturabilityFinding = { severity: "error" | "warning"; code: string; message: string; partId?: string; fastenerId?: string; jointId?: string };
export type AssemblyClearance = { partAId: string; partBId: string; result: ClearanceResult };

function validateQuaternion(q: readonly number[], partId?: string) {
  const norm = Math.hypot(...q);
  if (Math.abs(norm - 1) > 1e-6) throw new Error(`Coordinate frame quaternion must be normalized${partId ? ` for ${partId}` : ""}`);
}

export function validateAssembly(input: unknown, models: Record<string, ParametricModel> = {}): AssemblyModel {
  const assembly = AssemblyModel.parse(input);
  const partIds = new Set<string>();
  for (const part of assembly.parts) {
    if (partIds.has(part.id)) throw new Error(`Duplicate assembly part id: ${part.id}`);
    partIds.add(part.id);
    validateQuaternion(part.frame.rotationQuat, part.id);
    const model = models[part.model];
    if (model) {
      for (const tolerance of part.tolerances) {
        if (!model.parameters.some(parameter => parameter.name === tolerance.parameter)) throw new Error(`Unknown tolerance parameter ${tolerance.parameter} on part ${part.id}`);
        const nominal = resolveLength(model, tolerance.parameter);
        if (nominal - tolerance.minusMm <= 0) throw new Error(`Tolerance can produce a non-positive dimension: ${part.id}.${tolerance.parameter}`);
      }
    }
  }
  const jointIds = new Set<string>();
  for (const joint of assembly.joints) {
    if (jointIds.has(joint.id)) throw new Error(`Duplicate joint id: ${joint.id}`);
    jointIds.add(joint.id);
    if (joint.parentPartId === joint.childPartId) throw new Error(`Joint ${joint.id} cannot connect a part to itself`);
    if (!partIds.has(joint.parentPartId) || !partIds.has(joint.childPartId)) throw new Error(`Joint ${joint.id} references an unknown part`);
    if ((joint.lowerLimit !== undefined || joint.upperLimit !== undefined) && joint.limitUnit === undefined) throw new Error(`Joint ${joint.id} limits require limitUnit`);
    if (joint.lowerLimit !== undefined && joint.upperLimit !== undefined && joint.lowerLimit > joint.upperLimit) throw new Error(`Joint ${joint.id} lower limit exceeds upper limit`);
  }
  for (const fastener of assembly.fasteners) {
    if (new Set(fastener.partIds).size !== fastener.partIds.length) throw new Error(`Fastener ${fastener.id} contains duplicate part references`);
    if (fastener.partIds.some(id => !partIds.has(id))) throw new Error(`Fastener ${fastener.id} references an unknown part`);
  }
  return assembly;
}

function modelEnvelope(model: ParametricModel) {
  const box = model.features.find(feature => feature.type === "box");
  if (!box) return undefined;
  return { width: resolveLength(model, box.width), depth: resolveLength(model, box.depth), height: resolveLength(model, box.height) };
}

export function calculateAssemblyMassKg(input: unknown, models: Record<string, ParametricModel> = {}): number | undefined {
  const assembly = validateAssembly(input, models);
  let mass = 0;
  for (const part of assembly.parts) {
    if (!part.material?.densityKgM3) return undefined;
    const model = models[part.model];
    const envelope = model && modelEnvelope(model);
    if (!envelope) return undefined;
    mass += (envelope.width * envelope.depth * envelope.height) / 1e9 * part.material.densityKgM3;
  }
  return mass;
}

export function analyzeAssemblyClearances(input: unknown, models: Record<string, ParametricModel> = {}): AssemblyClearance[] {
  const assembly = validateAssembly(input, models);
  const boxes = new Map<string, ReturnType<typeof transformBox>>();
  for (const part of assembly.parts) {
    const model = models[part.model];
    const envelope = model && modelEnvelope(model);
    if (!envelope) continue;
    boxes.set(part.id, transformBox({ min: [0, 0, 0], max: [envelope.width, envelope.depth, envelope.height] }, part.frame));
  }
  const results: AssemblyClearance[] = [];
  for (let i = 0; i < assembly.parts.length; i++) for (let j = i + 1; j < assembly.parts.length; j++) {
    const a = assembly.parts[i];
    const b = assembly.parts[j];
    const boxA = boxes.get(a.id);
    const boxB = boxes.get(b.id);
    if (!boxA || !boxB) continue;
    results.push({ partAId: a.id, partBId: b.id, result: analyzeClearance(boxA, boxB) });
  }
  return results;
}

export function checkAssemblyManufacturability(input: unknown, models: Record<string, ParametricModel> = {}): ManufacturabilityFinding[] {
  const assembly = validateAssembly(input, models);
  const findings: ManufacturabilityFinding[] = [];
  const connected = new Set<string>();
  for (const joint of assembly.joints) {
    connected.add(joint.parentPartId);
    connected.add(joint.childPartId);
  }
  const capabilities = new Map(assembly.processCapabilities.map(capability => [capability.process, capability]));
  for (const part of assembly.parts) {
    if (assembly.parts.length > 1 && !connected.has(part.id)) findings.push({ severity: "warning", code: "DISCONNECTED_PART", message: `Part ${part.id} is not connected by any joint.`, partId: part.id });
    for (const tolerance of part.tolerances) {
      if (tolerance.plusMm + tolerance.minusMm === 0) findings.push({ severity: "warning", code: "ZERO_TOLERANCE", message: `Tolerance ${tolerance.parameter} on ${part.id} has zero allowable variation.`, partId: part.id });
      const capability = part.process ? capabilities.get(part.process) : undefined;
      if (capability?.toleranceMm !== undefined && Math.max(tolerance.plusMm, tolerance.minusMm) < capability.toleranceMm) findings.push({ severity: "error", code: "PROCESS_TOLERANCE_EXCEEDED", message: `Part ${part.id} requests a tighter tolerance than ${part.process} capability.`, partId: part.id });
    }
    if (part.process && part.material && part.material.supportedProcesses.length > 0 && !part.material.supportedProcesses.includes(part.process)) findings.push({ severity: "error", code: "MATERIAL_PROCESS_INCOMPATIBLE", message: `Material ${part.material.material} does not list ${part.process} as a supported process.`, partId: part.id });
    const capability = part.process ? capabilities.get(part.process) : undefined;
    const envelope = models[part.model] ? modelEnvelope(models[part.model]) : undefined;
    if (capability && envelope && capability.maxPartMm !== undefined && Math.max(envelope.width, envelope.depth, envelope.height) > capability.maxPartMm) findings.push({ severity: "error", code: "PART_SIZE_EXCEEDED", message: `Part ${part.id} exceeds ${part.process} maximum part size.`, partId: part.id });
  }
  for (const fastener of assembly.fasteners) if (fastener.quantity > 1000) findings.push({ severity: "warning", code: "HIGH_FASTENER_COUNT", message: `Fastener ${fastener.id} has an unusually high quantity.`, fastenerId: fastener.id });
  for (const joint of assembly.joints) if (joint.lowerLimit !== undefined && joint.upperLimit !== undefined && joint.lowerLimit === joint.upperLimit && joint.type !== "fixed") findings.push({ severity: "warning", code: "ZERO_MOTION_RANGE", message: `Joint ${joint.id} has no permitted motion range.`, jointId: joint.id });
  for (const clearance of analyzeAssemblyClearances(assembly, models)) if (clearance.result.intersects) findings.push({ severity: "error", code: "GEOMETRIC_INTERFERENCE", message: `Parts ${clearance.partAId} and ${clearance.partBId} have overlapping transformed bounding boxes.`, partId: clearance.partAId });
  return findings.sort((a, b) => `${a.code}:${a.partId ?? a.fastenerId ?? a.jointId ?? ""}`.localeCompare(`${b.code}:${b.partId ?? b.fastenerId ?? b.jointId ?? ""}`));
}

export function canonicalAssemblyJson(input: unknown): string {
  const assembly = validateAssembly(input);
  return JSON.stringify({
    ...assembly,
    parts: [...assembly.parts].sort((a, b) => a.id.localeCompare(b.id)),
    joints: [...assembly.joints].sort((a, b) => a.id.localeCompare(b.id)),
    fasteners: [...assembly.fasteners].sort((a, b) => a.id.localeCompare(b.id)),
    processCapabilities: [...assembly.processCapabilities].sort((a, b) => a.process.localeCompare(b.process)),
  });
}
