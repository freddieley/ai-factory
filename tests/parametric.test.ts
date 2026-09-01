import { describe, expect, it } from "vitest";
import { canonicalParametricJson, createParametricBox, resolveLength, validateParametricModel } from "../src/parametric.js";

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
});
