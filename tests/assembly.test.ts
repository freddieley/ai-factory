import { describe, expect, it } from "vitest";
import { canonicalAssemblyJson, checkAssemblyManufacturability, validateAssembly } from "../src/assembly.js";
import { createParametricBox } from "../src/parametric.js";

const models = { chassis: createParametricBox("chassis", 200, 100, 5) };
const base = {
  schema: "ai-factory.mechanical-assembly/v1" as const,
  name: "test assembly",
  units: "mm" as const,
  parts: [
    { id: "chassis", name: "Chassis", model: "chassis", tolerances: [{ parameter: "height", plusMm: 0.2, minusMm: 0.2 }] },
    { id: "cover", name: "Cover", model: "chassis", tolerances: [] },
  ],
  joints: [{ id: "hinge", type: "revolute" as const, parentPartId: "chassis", childPartId: "cover", axes: ["z"] as const }],
  fasteners: [{ id: "f1", standard: "ISO 4762", size: "M3x8", quantity: 4, partIds: ["chassis", "cover"] }],
};

describe("vendor-neutral mechanical assemblies", () => {
  it("validates parts, joints, fasteners and tolerances", () => {
    const assembly = validateAssembly(base, models);
    expect(assembly.parts).toHaveLength(2);
    expect(assembly.joints[0].type).toBe("revolute");
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
});
