import { createHash } from "node:crypto";
import { z } from "zod";
import { ElectronicsArchitecture } from "./electronics.js";

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export const RobotGeometryOperation = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  op: z.enum([
    "sketch",
    "line",
    "arc",
    "circle",
    "rectangle",
    "polygon",
    "spline",
    "extrude",
    "revolve",
    "loft",
    "sweep",
    "boolean_union",
    "boolean_cut",
    "boolean_intersect",
    "fillet",
    "chamfer",
    "shell",
    "pattern",
    "transform",
    "mirror",
    "datum",
  ]),
  inputs: z.array(z.string().min(1)).default([]),
  parameters: z.record(z.string(), Scalar).default({}),
});
export type RobotGeometryOperation = z.infer<typeof RobotGeometryOperation>;

export const RobotPart = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  name: z.string().min(1),
  material: z.string().min(1),
  manufacturingProcess: z.string().min(1),
  geometry: z.object({
    schema: z.literal("ai-factory.robot-geometry/v1"),
    units: z.literal("mm"),
    operations: z.array(RobotGeometryOperation).min(1),
    outputOperationId: z.string().min(1),
  }),
  massKg: z.number().finite().positive().optional(),
});
export type RobotPart = z.infer<typeof RobotPart>;

export const RobotJoint = z.object({
  id: z.string().min(1),
  parentPartId: z.string().min(1),
  childPartId: z.string().min(1),
  type: z.enum(["fixed", "revolute", "prismatic", "spherical", "planar"]),
  parameters: z.record(z.string(), Scalar).default({}),
});

export const RobotDesign = z.object({
  schema: z.literal("ai-factory.robot-design/v1"),
  name: z.string().min(1),
  mission: z.string().min(1),
  requirements: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    category: z.enum(["functional", "performance", "mechanical", "electrical", "manufacturing", "safety", "environmental", "cost", "other"]),
    value: z.union([z.string(), z.number()]).optional(),
    unit: z.string().optional(),
    priority: z.enum(["must", "should", "could"]),
    verificationMethod: z.string().optional(),
  })).min(1),
  parts: z.array(RobotPart).min(1),
  joints: z.array(RobotJoint).default([]),
  electronicsArchitecture: ElectronicsArchitecture.optional(),
  designRationale: z.array(z.string().min(1)).default([]),
  unresolvedQuestions: z.array(z.string().min(1)).default([]),
});
export type RobotDesign = z.infer<typeof RobotDesign>;

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} identifiers must be unique.`);
}

export function validateRobotDesign(input: unknown): RobotDesign {
  const design = RobotDesign.parse(input);
  assertUnique(design.requirements.map(requirement => requirement.id), "Requirement");
  assertUnique(design.parts.map(part => part.id), "Part");
  assertUnique(design.joints.map(joint => joint.id), "Joint");

  const partIds = new Set(design.parts.map(part => part.id));
  for (const joint of design.joints) {
    if (!partIds.has(joint.parentPartId) || !partIds.has(joint.childPartId)) {
      throw new Error(`Joint ${joint.id} references an unknown part.`);
    }
    if (joint.parentPartId === joint.childPartId) throw new Error(`Joint ${joint.id} cannot connect a part to itself.`);
  }

  for (const part of design.parts) {
    const operationIds = part.geometry.operations.map(operation => operation.id);
    assertUnique(operationIds, `Geometry operation in ${part.id}`);
    const operationSet = new Set(operationIds);
    for (const operation of part.geometry.operations) {
      for (const input of operation.inputs) {
        if (!operationSet.has(input)) throw new Error(`Geometry operation ${operation.id} references unknown input ${input}.`);
      }
    }
    if (!operationSet.has(part.geometry.outputOperationId)) {
      throw new Error(`Part ${part.id} outputOperationId references an unknown geometry operation.`);
    }
  }

  return design;
}

export function canonicalRobotDesignJson(input: unknown): string {
  const design = validateRobotDesign(input);
  const normalized = {
    ...design,
    requirements: [...design.requirements].sort((a, b) => a.id.localeCompare(b.id)),
    parts: [...design.parts].sort((a, b) => a.id.localeCompare(b.id)).map(part => ({
      ...part,
      geometry: {
        ...part.geometry,
        operations: [...part.geometry.operations].sort((a, b) => a.id.localeCompare(b.id)),
      },
    })),
    joints: [...design.joints].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return JSON.stringify(normalized);
}

export function robotDesignHash(input: unknown): string {
  return createHash("sha256").update(canonicalRobotDesignJson(input)).digest("hex");
}
