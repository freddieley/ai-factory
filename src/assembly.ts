import { z } from "zod";
import { ParametricModel, resolveLength } from "./parametric.js";

const positive = z.number().finite().positive();
const nonNegative = z.number().finite().nonnegative();

export const MaterialSpec = z.object({
  material: z.string().min(1),
  densityKgM3: positive.optional(),
  maxServiceTempC: z.number().finite().optional(),
});

export const ToleranceSpec = z.object({
  parameter: z.string().min(1),
  plusMm: nonNegative,
  minusMm: nonNegative,
});

export const AssemblyPart = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  name: z.string().min(1),
  model: z.string().min(1),
  material: MaterialSpec.optional(),
  tolerances: z.array(ToleranceSpec).default([]),
});

export const Joint = z.object({
  id: z.string().min(1),
  type: z.enum(["fixed", "revolute", "prismatic", "ball", "cylindrical"]),
  parentPartId: z.string().min(1),
  childPartId: z.string().min(1),
  axes: z.array(z.enum(["x", "y", "z"])).min(1).default(["z"]),
});

export const Fastener = z.object({
  id: z.string().min(1),
  standard: z.string().min(1),
  size: z.string().min(1),
  quantity: z.number().int().positive(),
  partIds: z.array(z.string().min(1)).min(2),
  material: z.string().min(1).optional(),
});

export const AssemblyModel = z.object({
  schema: z.literal("ai-factory.mechanical-assembly/v1"),
  name: z.string().min(1),
  units: z.literal("mm"),
  parts: z.array(AssemblyPart).min(1),
  joints: z.array(Joint).default([]),
  fasteners: z.array(Fastener).default([]),
});

export type AssemblyModel = z.infer<typeof AssemblyModel>;
export type ManufacturabilityFinding = { severity: "error" | "warning"; code: string; message: string; partId?: string; fastenerId?: string };

export function validateAssembly(input: unknown, models: Record<string, ParametricModel> = {}): AssemblyModel {
  const assembly = AssemblyModel.parse(input);
  const partIds = new Set<string>();
  for (const part of assembly.parts) {
    if (partIds.has(part.id)) throw new Error(`Duplicate assembly part id: ${part.id}`);
    partIds.add(part.id);
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
  }
  for (const fastener of assembly.fasteners) {
    if (new Set(fastener.partIds).size !== fastener.partIds.length) throw new Error(`Fastener ${fastener.id} contains duplicate part references`);
    if (fastener.partIds.some(id => !partIds.has(id))) throw new Error(`Fastener ${fastener.id} references an unknown part`);
  }
  return assembly;
}

export function checkAssemblyManufacturability(input: unknown, models: Record<string, ParametricModel> = {}): ManufacturabilityFinding[] {
  const assembly = validateAssembly(input, models);
  const findings: ManufacturabilityFinding[] = [];
  const connected = new Set<string>();
  for (const joint of assembly.joints) {
    connected.add(joint.parentPartId);
    connected.add(joint.childPartId);
  }
  for (const part of assembly.parts) {
    if (assembly.parts.length > 1 && !connected.has(part.id)) findings.push({ severity: "warning", code: "DISCONNECTED_PART", message: `Part ${part.id} is not connected by any joint.`, partId: part.id });
    for (const tolerance of part.tolerances) {
      if (tolerance.plusMm + tolerance.minusMm === 0) findings.push({ severity: "warning", code: "ZERO_TOLERANCE", message: `Tolerance ${tolerance.parameter} on ${part.id} has zero allowable variation.`, partId: part.id });
    }
  }
  for (const fastener of assembly.fasteners) {
    if (fastener.quantity > 1000) findings.push({ severity: "warning", code: "HIGH_FASTENER_COUNT", message: `Fastener ${fastener.id} has an unusually high quantity.`, fastenerId: fastener.id });
  }
  return findings.sort((a, b) => `${a.code}:${a.partId ?? a.fastenerId ?? ""}`.localeCompare(`${b.code}:${b.partId ?? b.fastenerId ?? ""}`));
}

export function canonicalAssemblyJson(input: unknown): string {
  const assembly = validateAssembly(input);
  return JSON.stringify({
    ...assembly,
    parts: [...assembly.parts].sort((a, b) => a.id.localeCompare(b.id)),
    joints: [...assembly.joints].sort((a, b) => a.id.localeCompare(b.id)),
    fasteners: [...assembly.fasteners].sort((a, b) => a.id.localeCompare(b.id)),
  });
}
