import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalParametricJson, type ParametricModel, validateParametricModel } from "./parametric.js";

const finite = z.number().finite();

export const DesignVariable = z.object({
  parameter: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  minMm: finite.positive(),
  maxMm: finite.positive(),
  stepMm: finite.positive(),
}).refine(value => value.maxMm >= value.minMm, { message: "maxMm must be greater than or equal to minMm" });
export type DesignVariable = z.infer<typeof DesignVariable>;

export const DesignConstraint = z.object({
  id: z.string().min(1),
  parameter: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  minMm: finite.optional(),
  maxMm: finite.optional(),
}).refine(value => value.minMm !== undefined || value.maxMm !== undefined, { message: "constraint requires minMm or maxMm" })
  .refine(value => value.minMm === undefined || value.maxMm === undefined || value.minMm <= value.maxMm, { message: "constraint minMm must not exceed maxMm" });
export type DesignConstraint = z.infer<typeof DesignConstraint>;

export const DesignObjective = z.object({
  parameter: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  direction: z.enum(["minimize", "maximize"]),
});
export type DesignObjective = z.infer<typeof DesignObjective>;

export const DesignSpace = z.object({
  variables: z.array(DesignVariable).min(1),
  constraints: z.array(DesignConstraint).default([]),
  objective: DesignObjective,
  maxCandidates: z.number().int().positive().max(100_000).default(10_000),
});
export type DesignSpace = z.infer<typeof DesignSpace>;

export type DesignCandidate = {
  model: ParametricModel;
  objectiveValueMm: number;
  rank: number;
  hash: string;
};

function values(variable: DesignVariable): number[] {
  const result: number[] = [];
  const count = Math.floor((variable.maxMm - variable.minMm) / variable.stepMm + 1e-9);
  for (let index = 0; index <= count; index++) {
    const value = variable.minMm + index * variable.stepMm;
    if (value <= variable.maxMm + 1e-9) result.push(Number(value.toFixed(12)));
  }
  if (!result.length || result[result.length - 1] < variable.maxMm - 1e-9) result.push(variable.maxMm);
  return result;
}

function hashModel(model: ParametricModel): string {
  return createHash("sha256").update(canonicalParametricJson(model)).digest("hex");
}

function satisfiesConstraints(model: ParametricModel, constraints: DesignConstraint[]): boolean {
  const parameters = new Map(model.parameters.map(parameter => [parameter.name, parameter.valueMm]));
  return constraints.every(constraint => {
    const value = parameters.get(constraint.parameter);
    if (value === undefined) return false;
    return (constraint.minMm === undefined || value >= constraint.minMm) && (constraint.maxMm === undefined || value <= constraint.maxMm);
  });
}

function withParameters(base: ParametricModel, assignments: Map<string, number>): ParametricModel {
  return validateParametricModel({
    ...base,
    parameters: base.parameters.map(parameter => ({ ...parameter, valueMm: assignments.get(parameter.name) ?? parameter.valueMm })),
  });
}

export function exploreDesignSpace(modelInput: unknown, input: unknown): DesignCandidate[] {
  const base = validateParametricModel(modelInput);
  const space = DesignSpace.parse(input);
  const parameterNames = new Set(base.parameters.map(parameter => parameter.name));
  const variableNames = new Set<string>();
  for (const variable of space.variables) {
    if (!parameterNames.has(variable.parameter)) throw new Error(`Unknown design variable parameter: ${variable.parameter}`);
    if (variableNames.has(variable.parameter)) throw new Error(`Duplicate design variable parameter: ${variable.parameter}`);
    variableNames.add(variable.parameter);
  }
  if (!parameterNames.has(space.objective.parameter)) throw new Error(`Unknown objective parameter: ${space.objective.parameter}`);
  for (const constraint of space.constraints) if (!parameterNames.has(constraint.parameter)) throw new Error(`Unknown constraint parameter: ${constraint.parameter}`);

  const domains = space.variables.map(variable => ({ variable, values: values(variable) }));
  let combinations = 1;
  for (const domain of domains) {
    combinations *= domain.values.length;
    if (combinations > space.maxCandidates) throw new Error(`Design space contains ${combinations} candidates, exceeding maxCandidates ${space.maxCandidates}`);
  }

  const candidates: DesignCandidate[] = [];
  const assignments = new Map<string, number>();
  const visit = (index: number) => {
    if (index === domains.length) {
      const model = withParameters(base, assignments);
      if (!satisfiesConstraints(model, space.constraints)) return;
      const objectiveValueMm = model.parameters.find(parameter => parameter.name === space.objective.parameter)!.valueMm;
      candidates.push({ model, objectiveValueMm, rank: 0, hash: hashModel(model) });
      return;
    }
    const domain = domains[index];
    for (const value of domain.values) {
      assignments.set(domain.variable.parameter, value);
      visit(index + 1);
    }
  };
  visit(0);

  candidates.sort((a, b) => space.objective.direction === "minimize"
    ? a.objectiveValueMm - b.objectiveValueMm || a.hash.localeCompare(b.hash)
    : b.objectiveValueMm - a.objectiveValueMm || a.hash.localeCompare(b.hash));
  return candidates.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
