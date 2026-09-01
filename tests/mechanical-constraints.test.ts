import { describe, expect, it } from "vitest";
import { createParametricBox } from "../src/parametric.js";
import { analyzeFit, analyzeFits, checkMechanicalConstraints, validateDatumScheme, transformDatum, type MechanicalConstraintModel } from "../src/mechanical-constraints.js";

const model = createParametricBox("plate", 200, 100, 5);
const assembly = {
  schema: "ai-factory.mechanical-assembly/v1" as const,
  name: "mechanical test",
  units: "mm" as const,
  parts: [{ id: "plate", name: "Plate", model: "plate", material: { material: "6061-T6", supportedProcesses: ["cnc"] }, process: "cnc" }],
  joints: [],
  fasteners: [],
  processCapabilities: [],
};

describe("advanced mechanical constraints", () => {
  it("validates a complete primary-secondary-tertiary datum scheme", () => {
    const datums = validateDatumScheme([
      { id: "A", role: "primary", normal: [0, 0, 1], xDirection: [1, 0, 0] },
      { id: "B", role: "secondary", normal: [0, 1, 0], xDirection: [1, 0, 0] },
      { id: "C", role: "tertiary", normal: [1, 0, 0], xDirection: [0, 1, 0] },
    ]);
    expect(datums.map(d => d.role)).toEqual(["primary", "secondary", "tertiary"]);
  });

  it("rejects duplicate or non-orthogonal datum frames", () => {
    expect(() => validateDatumScheme([
      { id: "A", role: "primary", normal: [0, 0, 1], xDirection: [1, 0, 0] },
      { id: "A2", role: "primary", normal: [0, 1, 0], xDirection: [1, 0, 0] },
    ])).toThrow(/Duplicate primary/);
    expect(() => validateDatumScheme([
      { id: "A", role: "primary", normal: [0, 0, 1], xDirection: [0, 0, 2] },
    ])).toThrow(/perpendicular/);
  });

  it("transforms datum origin and directions without changing direction magnitude", () => {
    const datum = validateDatumScheme([{ id: "A", role: "primary", originMm: [1, 2, 3], normal: [0, 0, 1], xDirection: [1, 0, 0] }])[0];
    const transformed = transformDatum(datum, { originMm: [10, 0, 0], rotationQuat: [0, 0, 0, 1] });
    expect(transformed.originMm).toEqual([11, 2, 3]);
    expect(transformed.normal).toEqual([0, 0, 1]);
    expect(transformed.xDirection).toEqual([1, 0, 0]);
  });

  it("computes worst-case fit clearance and deterministic fit ordering", () => {
    const fit = analyzeFit({ id: "shaft", type: "clearance", holeNominalMm: 10, shaftNominalMm: 9.8, holeMinusMm: 0.05, shaftPlusMm: 0.05 });
    expect(fit.nominalClearanceMm).toBeCloseTo(0.2, 8);
    expect(fit.minClearanceMm).toBeCloseTo(0.1, 8);
    expect(fit.maxClearanceMm).toBeCloseTo(0.3, 8);
    expect(fit.passes).toBe(true);
    expect(analyzeFits([
      { id: "z", type: "clearance", holeNominalMm: 10, shaftNominalMm: 9 },
      { id: "a", type: "clearance", holeNominalMm: 10, shaftNominalMm: 9 },
    ]).map(f => f.id)).toEqual(["a", "z"]);
  });

  it("detects a fit that fails its declared clearance class", () => {
    expect(analyzeFit({ id: "bad", type: "clearance", holeNominalMm: 10, shaftNominalMm: 10, shaftPlusMm: 0.1 }).passes).toBe(false);
  });

  it("attaches machine capability evidence to machine-specific findings", () => {
    const input: MechanicalConstraintModel = {
      assembly,
      machineCapabilities: [{ machineId: "cnc-01", machineName: "CNC 01", process: "cnc", materials: ["steel"], maxPartMm: 150, evidenceIds: ["EVID-MACHINE-1"] }],
      materials: [{ id: "6061", name: "6061-T6", supportedProcesses: ["cnc"], evidenceIds: ["EVID-MATERIAL-1"] }],
      fits: [],
      datums: { plate: [{ id: "A", role: "primary", normal: [0, 0, 1], xDirection: [1, 0, 0] }] },
    };
    const findings = checkMechanicalConstraints(input, { plate: model });
    expect(findings.map(f => f.code)).toEqual(["MACHINE_MATERIAL_UNSUPPORTED", "MACHINE_ENVELOPE_EXCEEDED"]);
    expect(findings.every(f => f.evidenceIds)).toBe(true);
  });
});
