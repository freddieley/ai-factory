import { z } from "zod";
import { transformPoint, type Point3, type Transform } from "./geometry.js";
import { type ParametricModel, resolveLength } from "./parametric.js";
import { validateAssembly } from "./assembly.js";

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const positive = finite.positive();

export const DatumReference = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  role: z.enum(["primary", "secondary", "tertiary"]),
  originMm: z.tuple([finite, finite, finite]).default([0, 0, 0]),
  normal: z.tuple([finite, finite, finite]),
  xDirection: z.tuple([finite, finite, finite]),
  toleranceMm: nonNegative.default(0),
});
export type DatumReference = z.infer<typeof DatumReference>;

export const FitSpec = z.object({
  id: z.string().min(1),
  type: z.enum(["clearance", "transition", "interference"]),
  holeNominalMm: positive,
  shaftNominalMm: positive,
  holePlusMm: nonNegative.default(0),
  holeMinusMm: nonNegative.default(0),
  shaftPlusMm: nonNegative.default(0),
  shaftMinusMm: nonNegative.default(0),
  requiredMinClearanceMm: nonNegative.default(0),
  requiredMaxClearanceMm: nonNegative.optional(),
});
export type FitSpec = z.infer<typeof FitSpec>;

export const MaterialRecord = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  grade: z.string().min(1).optional(),
  densityKgM3: positive.optional(),
  yieldStrengthMPa: positive.optional(),
  tensileStrengthMPa: positive.optional(),
  hardnessHRC: nonNegative.optional(),
  maxServiceTempC: finite.optional(),
  supportedProcesses: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().min(1)).default([]),
});
export type MaterialRecord = z.infer<typeof MaterialRecord>;

export const MachineCapability = z.object({
  machineId: z.string().min(1),
  machineName: z.string().min(1),
  process: z.string().min(1),
  materials: z.array(z.string().min(1)).default([]),
  maxPartMm: positive.optional(),
  minFeatureMm: nonNegative.default(0),
  achievableToleranceMm: positive.optional(),
  axisTravelMm: z.tuple([positive, positive, positive]).optional(),
  evidenceIds: z.array(z.string().min(1)).default([]),
});
export type MachineCapability = z.infer<typeof MachineCapability>;

export const MechanicalConstraintModel = z.object({
  assembly: z.unknown(),
  datums: z.record(z.string(), z.array(DatumReference)).default({}),
  fits: z.array(FitSpec).default([]),
  materials: z.array(MaterialRecord).default([]),
  machineCapabilities: z.array(MachineCapability).default([]),
});
export type MechanicalConstraintModel = z.infer<typeof MechanicalConstraintModel>;

export type FitAnalysis = {
  id: string;
  type: FitSpec["type"];
  nominalClearanceMm: number;
  minClearanceMm: number;
  maxClearanceMm: number;
  passes: boolean;
};

export type MechanicalFinding = {
  severity: "error" | "warning";
  code: string;
  message: string;
  evidenceIds: string[];
  partId?: string;
  machineId?: string;
  fitId?: string;
};

function dot(a: readonly number[], b: readonly number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: readonly number[], b: readonly number[]): Point3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function magnitude(v: readonly number[]) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Point3, name: string): Point3 {
  const length = magnitude(v);
  if (length < 1e-12) throw new Error(`${name} must have non-zero magnitude`);
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function validateDatumScheme(input: unknown): DatumReference[] {
  const datums = z.array(DatumReference).parse(input);
  const ids = new Set<string>();
  const roles = new Set<DatumReference["role"]>();
  for (const datum of datums) {
    if (ids.has(datum.id)) throw new Error(`Duplicate datum id: ${datum.id}`);
    ids.add(datum.id);
    if (roles.has(datum.role)) throw new Error(`Duplicate ${datum.role} datum`);
    roles.add(datum.role);
    const normal = normalize(datum.normal, `Datum ${datum.id} normal`);
    const xDirection = normalize(datum.xDirection, `Datum ${datum.id} xDirection`);
    if (Math.abs(dot(normal, xDirection)) > 1e-6) throw new Error(`Datum ${datum.id} normal and xDirection must be perpendicular`);
    if (magnitude(cross(normal, xDirection)) < 1e-6) throw new Error(`Datum ${datum.id} frame is degenerate`);
  }
  const roleOrder = ["primary", "secondary", "tertiary"] as const;
  for (let i = 0; i < roles.size; i++) if (!roles.has(roleOrder[i])) throw new Error("Datum scheme must be contiguous from primary through tertiary");
  return datums.map(datum => ({ ...datum, normal: normalize(datum.normal, `Datum ${datum.id} normal`), xDirection: normalize(datum.xDirection, `Datum ${datum.id} xDirection`) }));
}

export function transformDatum(datum: DatumReference, transform: Transform): DatumReference {
  const origin = transformPoint(datum.originMm, transform);
  const normalEnd = transformPoint([datum.originMm[0] + datum.normal[0], datum.originMm[1] + datum.normal[1], datum.originMm[2] + datum.normal[2]], transform);
  const xEnd = transformPoint([datum.originMm[0] + datum.xDirection[0], datum.originMm[1] + datum.xDirection[1], datum.originMm[2] + datum.xDirection[2]], transform);
  return {
    ...datum,
    originMm: origin,
    normal: normalize([normalEnd[0] - origin[0], normalEnd[1] - origin[1], normalEnd[2] - origin[2]], `Datum ${datum.id} normal`),
    xDirection: normalize([xEnd[0] - origin[0], xEnd[1] - origin[1], xEnd[2] - origin[2]], `Datum ${datum.id} xDirection`),
  };
}

export function analyzeFit(input: unknown): FitAnalysis {
  const fit = FitSpec.parse(input);
  const nominalClearanceMm = fit.holeNominalMm - fit.shaftNominalMm;
  const minClearanceMm = (fit.holeNominalMm - fit.holeMinusMm) - (fit.shaftNominalMm + fit.shaftPlusMm);
  const maxClearanceMm = (fit.holeNominalMm + fit.holePlusMm) - (fit.shaftNominalMm - fit.shaftMinusMm);
  const typePasses = fit.type === "clearance" ? minClearanceMm >= 0 : fit.type === "interference" ? maxClearanceMm <= 0 : minClearanceMm <= 0 && maxClearanceMm >= 0;
  const passes = typePasses && minClearanceMm >= fit.requiredMinClearanceMm && (fit.requiredMaxClearanceMm === undefined || maxClearanceMm <= fit.requiredMaxClearanceMm);
  return { id: fit.id, type: fit.type, nominalClearanceMm, minClearanceMm, maxClearanceMm, passes };
}

export function analyzeFits(inputs: unknown): FitAnalysis[] {
  return z.array(FitSpec).parse(inputs).map(analyzeFit).sort((a, b) => a.id.localeCompare(b.id));
}

export function checkMachineCapability(part: { id: string; process?: string; material?: { material: string } }, model: ParametricModel | undefined, capability: MachineCapability): MechanicalFinding[] {
  if (part.process !== capability.process) return [];
  const findings: MechanicalFinding[] = [];
  if (!capability.materials.includes(part.material?.material ?? "")) findings.push({ severity: "error", code: "MACHINE_MATERIAL_UNSUPPORTED", message: `Machine ${capability.machineId} does not declare support for material ${part.material?.material ?? "unknown"}.`, evidenceIds: capability.evidenceIds, partId: part.id, machineId: capability.machineId });
  const box = model?.features.find(feature => feature.type === "box");
  if (box && capability.maxPartMm !== undefined && model) {
    const dimensions = [resolveLength(model, box.width), resolveLength(model, box.depth), resolveLength(model, box.height)];
    if (dimensions.some(value => value > capability.maxPartMm!)) findings.push({ severity: "error", code: "MACHINE_ENVELOPE_EXCEEDED", message: `Part ${part.id} exceeds machine ${capability.machineId} envelope.`, evidenceIds: capability.evidenceIds, partId: part.id, machineId: capability.machineId });
  }
  return findings;
}

export function checkMechanicalConstraints(input: MechanicalConstraintModel, models: Record<string, ParametricModel> = {}): MechanicalFinding[] {
  const value = MechanicalConstraintModel.parse(input);
  const assembly = validateAssembly(value.assembly, models);
  const findings: MechanicalFinding[] = [];
  for (const [partId, datums] of Object.entries(value.datums)) {
    if (!assembly.parts.some(part => part.id === partId)) {
      findings.push({ severity: "error", code: "UNKNOWN_DATUM_PART", message: `Datum scheme references unknown part ${partId}.`, evidenceIds: [], partId });
      continue;
    }
    try { validateDatumScheme(datums); } catch (error) { findings.push({ severity: "error", code: "INVALID_DATUM_SCHEME", message: error instanceof Error ? error.message : String(error), evidenceIds: [], partId }); }
  }
  for (const fit of analyzeFits(value.fits)) if (!fit.passes) findings.push({ severity: "error", code: "FIT_OUT_OF_TOLERANCE", message: `Fit ${fit.id} does not satisfy its declared class or clearance envelope.`, evidenceIds: [], fitId: fit.id });
  const materials = new Map(value.materials.map(material => [material.id, material]));
  for (const part of assembly.parts) {
    const material = part.material ? [...materials.values()].find(candidate => candidate.name === part.material?.material || candidate.id === part.material?.material) : undefined;
    for (const capability of value.machineCapabilities) findings.push(...checkMachineCapability(part, models[part.model], capability));
    if (material && material.supportedProcesses.length && part.process && !material.supportedProcesses.includes(part.process)) findings.push({ severity: "error", code: "MATERIAL_PROCESS_INCOMPATIBLE", message: `Material ${material.name} is not declared compatible with ${part.process}.`, evidenceIds: material.evidenceIds, partId: part.id });
  }
  return findings.sort((a, b) => `${a.code}:${a.partId ?? a.fitId ?? a.machineId ?? ""}`.localeCompare(`${b.code}:${b.partId ?? b.fitId ?? b.machineId ?? ""}`));
}
