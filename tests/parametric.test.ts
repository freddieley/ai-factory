import { describe, expect, it } from "vitest";
import { canonicalParametricJson, createParametricBox, resolveLength, validateParametricModel } from "../src/parametric.js";
import { createHash } from "node:crypto";

describe("vendor-neutral parametric mechanical model", () => {
  it("creates a deterministic parameterized box", () => {
    const model = createParametricBox("test-box", 50, 40, 5);
    expect(model.schema).toBe("ai-factory.parametric-mechanical/v1");
    expect(model.units).toBe("mm");
    expect(model.features[0]).toMatchObject({ type: "box", width: "width", depth: "depth", height: "height" });
    expect(resolveLength(model, "width")).toBe(50);
    expect(canonicalParametricJson(model)).toBe(canonicalParametricJson(model));
  });

  it("rejects unknown and unsafe dimensions", () => {
    const model = createParametricBox("safe", 20, 20, 2);
    expect(() => resolveLength(model, "missing")).toThrow("Unknown length parameter");
    expect(() => validateParametricModel({
      ...model,
      parameters: [{ name: "width", valueMm: 20_001 }],
    })).toThrow("10,000 mm safety limit");
  });

  it("preserves explicit literal dimensions alongside parameters", () => {
    const model = validateParametricModel({
      schema: "ai-factory.parametric-mechanical/v1",
      name: "mixed",
      units: "mm",
      parameters: [{ name: "height", valueMm: 5 }],
      features: [{ type: "box", name: "base", width: "25", depth: "30", height: "height" }],
    });
    expect(resolveLength(model, "25")).toBe(25);
    expect(resolveLength(model, "height")).toBe(5);
  });

  it("validates a known centered-hole plate design", () => {
    const model = validateParametricModel({
      schema: "ai-factory.parametric-mechanical/v1",
      name: "50x30x5 plate with centered 10mm through-hole",
      units: "mm",
      parameters: [
        { name: "width", valueMm: 50, description: "Overall X dimension" },
        { name: "depth", valueMm: 30, description: "Overall Y dimension" },
        { name: "height", valueMm: 5, description: "Overall Z dimension" },
        { name: "holeDiameter", valueMm: 10, description: "Through-hole diameter" },
        { name: "holeX", valueMm: 25, description: "Hole center X" },
        { name: "holeY", valueMm: 15, description: "Hole center Y" },
      ],
      features: [
        { type: "box", name: "base", width: "width", depth: "depth", height: "height" },
        { type: "through_hole", name: "center_hole", diameter: "holeDiameter", x: "holeX", y: "holeY" },
      ],
    });
    const canonical = canonicalParametricJson(model);
    expect(createHash("sha256").update(canonical).digest("hex")).toBe("9b65848d00a4bb2449cae28c1d779f9258e110209976c5a2439c8bb936d9bead");
    expect(() => validateParametricModel({
      ...model,
      parameters: model.parameters.map(parameter => parameter.name === "holeX" ? { ...parameter, valueMm: 3 } : parameter),
    })).toThrow("fully inside the base envelope");
  });
});
