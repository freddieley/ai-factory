import { z } from "zod";

export const Parameter = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  valueMm: z.number().finite().positive(),
  description: z.string().min(1).optional(),
});

export const BoxFeature = z.object({
  type: z.literal("box"),
  name: z.string().min(1),
  width: z.string().min(1),
  depth: z.string().min(1),
  height: z.string().min(1),
});

export const HoleFeature = z.object({
  type: z.literal("through_hole"),
  name: z.string().min(1),
  diameter: z.string().min(1),
  x: z.string().min(1),
  y: z.string().min(1),
});

export const MechanicalFeature = z.discriminatedUnion("type", [BoxFeature, HoleFeature]);

export const ParametricModel = z.object({
  schema: z.literal("ai-factory.parametric-mechanical/v1"),
  name: z.string().min(1),
  units: z.literal("mm"),
  parameters: z.array(Parameter).min(1),
  features: z.array(MechanicalFeature).min(1),
});

export type ParametricModel = z.infer<typeof ParametricModel>;

function parameterMap(model: ParametricModel) {
  return new Map(model.parameters.map(parameter => [parameter.name, parameter.valueMm]));
}

export function resolveLength(model: ParametricModel, expression: string): number {
  const literal = Number(expression);
  if (Number.isFinite(literal) && literal > 0) return literal;
  const value = parameterMap(model).get(expression);
  if (value === undefined) throw new Error(`Unknown length parameter: ${expression}`);
  return value;
}

export function validateParametricModel(input: unknown): ParametricModel {
  const model = ParametricModel.parse(input);
  for (const feature of model.features) {
    for (const expression of feature.type === "box"
      ? [feature.width, feature.depth, feature.height]
      : [feature.diameter, feature.x, feature.y]) {
      if (resolveLength(model, expression) > 10_000) throw new Error(`Parametric dimension exceeds the 10,000 mm safety limit: ${expression}`);
    }
  }
  return model;
}

export function createParametricBox(name: string, widthMm: number, depthMm: number, heightMm: number): ParametricModel {
  return validateParametricModel({
    schema: "ai-factory.parametric-mechanical/v1",
    name,
    units: "mm",
    parameters: [
      { name: "width", valueMm: widthMm, description: "Overall X dimension" },
      { name: "depth", valueMm: depthMm, description: "Overall Y dimension" },
      { name: "height", valueMm: heightMm, description: "Overall Z dimension" },
    ],
    features: [{ type: "box", name: "base", width: "width", depth: "depth", height: "height" }],
  });
}

export function canonicalParametricJson(model: ParametricModel): string {
  const normalized = validateParametricModel(model);
  const parameters = [...normalized.parameters].sort((a, b) => a.name.localeCompare(b.name));
  const features = [...normalized.features].sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify({ ...normalized, parameters, features });
}
