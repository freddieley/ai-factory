import { describe, expect, it } from "vitest";
import { analyzeAssemblyClearances, calculateAssemblyMassKg, canonicalAssemblyJson, checkAssemblyManufacturability, validateAssembly } from "../src/assembly.js";
import { createParametricBox } from "../src/parametric.js";

const models = { chassis: createParametricBox("chassis", 200, 100, 5) };
const base = {
  schema: "ai-factory.mechanical-assembly/v1" as const,
  name: "test assembly",
  units: "mm" as const,
  parts: [
    { id: "chassis", name: "Chassis", model: "chassis", tolerances: [{ parameter: "height", plusMm: 0.2, minusMm: 0.2 }], material: { material: "aluminum", densityKgM3: 2700, supportedProcesses: ["cnc"] }, process: "cnc" },
    { id: "cover", name: "Cover", model: "chassis", tolerances: [] },
  ],
  joints: [{ id: "hinge", type: "revolute" as const, parentPartId: "chassis", childPartId: "cover", axes: ["z"] as const, lowerLimit: -90, upperLimit: 90, limitUnit: "deg" as const }],
  fasteners: [{ id: "f1", standard: "ISO 4762", size: "M3x8", quantity: 4, partIds: ["chassis", "cover"] }],
  processCapabilities: [{ process: "cnc", toleranceMm: 0.05, maxPartMm: 500, materials: ["aluminum"] }],
};

describe("vendor-neutral mechanical assemblies", () => {
  it("validates parts, joints, fasteners, frames and tolerances", () => {
    const assembly = validateAssembly(base, models);
    expect(assembly.parts).toHaveLength(2);
    expect(assembly.joints[0].type).toBe("revolute");
    expect(assembly.joints[0].upperLimit).toBe(90);
  });

  it("rejects joints and fasteners that reference unknown parts", () => {
    expect(() => validateAssembly({ ...base, joints: [{ ...base.joints[0], childPartId: "missing" }] })).toThrow(/unknown part/);
    expect(() => validateAssembly({ ...base, fasteners: [{ ...base.fasteners[0], partIds: ["chassis", "missing"] }] })).toThrow(/unknown part/);
  });

  it("detects disconnected parts and preserves deterministic ordering", () => {
    const reordered = { ...base, parts: [...base.parts].reverse(), joints: [...base.joints].reverse(), fasteners: [...base.fasteners].reverse() };
    expect(checkAssemblyManufacturability({ ...base, joints: [] }, models)[0].code).toBe("DISCONNECTED_PART");
    expect(canonicalAssemblyJson(base)).toBe(canonicalAssemblyJson(reordered));
  });

  it("rejects tolerances that can make a dimension non-positive", () => {
    expect(() => validateAssembly({ ...base, parts: [{ ...base.parts[0], tolerances: [{ parameter: "height", plusMm: 0, minusMm: 5.1 }] }, base.parts[1]] }, models)).toThrow(/non-positive/);
  });

  it("calculates mass from explicit material density and box geometry", () => {
    const standalone = { ...base, parts: [base.parts[0]], joints: [], fasteners: [] };
    expect(calculateAssemblyMassKg(standalone, models)).toBeCloseTo(0.27, 6);
    expect(calculateAssemblyMassKg({ ...standalone, parts: [{ ...base.parts[0], material: undefined }] }, models)).toBeUndefined();
  });

  it("detects transformed part interference", () => {
    const separated = { ...base, parts: [base.parts[0], { ...base.parts[1], frame: { originMm: [210, 0, 0], rotationQuat: [0, 0, 0, 1] } }] };
    expect(analyzeAssemblyClearances(separated, models)[0].result).toEqual({ intersects: false, clearanceMm: 10, axis: "x" });
    const findings = checkAssemblyManufacturability(base, models);
    expect(findings.map(f => f.code)).toContain("GEOMETRIC_INTERFERENCE");
  });

  it("detects process/material incompatibility and capability violations", () => {
    const findings = checkAssemblyManufacturability({ ...base, parts: [{ ...base.parts[0], material: { material: "carbon-fiber", densityKgM3: 1600, supportedProcesses: ["layup"] }, process: "cnc", tolerances: [{ parameter: "height", plusMm: 0.01, minusMm: 0.01 }] }] }, models);
    expect(findings.map(f => f.code)).toContain("MATERIAL_PROCESS_INCOMPATIBLE");
    expect(findings.map(f => f.code)).toContain("PROCESS_TOLERANCE_EXCEEDED");
  });

  it("rejects non-normalized coordinate frames and invalid joint limits", () => {
    expect(() => validateAssembly({ ...base, parts: [{ ...base.parts[0], frame: { originMm: [0, 0, 0], rotationQuat: [0, 0, 0, 2] } }, base.parts[1]] }, models)).toThrow(/normalized/);
    expect(() => validateAssembly({ ...base, joints: [{ ...base.joints[0], lowerLimit: 10, upperLimit: -10 }] }, models)).toThrow(/lower limit/);
  });
});
