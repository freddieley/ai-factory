import { describe, expect, it } from "vitest";
import { compileRobotDesignToFusionScript } from "../src/robot-cad-compiler.js";

describe("robot CAD compiler", () => {
  const design = {
    schema: "ai-factory.robot-design/v1",
    name: "Freeform rover chassis",
    mission: "Inspect equipment indoors",
    requirements: [{ id: "R1", description: "Carry inspection payload", category: "functional", priority: "must" }],
    parts: [{ id: "body", name: "Custom chassis", material: "aluminium", manufacturingProcess: "CNC machining", geometry: { schema: "ai-factory.robot-geometry/v1", units: "mm", operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: { plane: "XY" } },
      { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 120, heightMm: 80 } },
      { id: "solid", op: "extrude", inputs: ["sk"], parameters: { distanceMm: 4 } },
    ], outputOperationId: "solid" } }],
    joints: [], designRationale: [], unresolvedQuestions: [],
  };

  it("compiles a model-authored feature graph rather than a template", () => {
    const result = compileRobotDesignToFusionScript(design);
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.designHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.script).toContain("Custom chassis");
    expect(result.script).toContain("extrudeFeatures.createInput");
    expect(result.script).not.toContain("executeCreateBox");
  });

  it("refuses unsupported operations instead of silently substituting geometry", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [{ id: "s", op: "sweep", inputs: [], parameters: {} }], outputOperationId: "s" } }] });
    expect(result.unsupportedOperations).toContain("body:s:sweep");
    expect(result.script).not.toContain("createBox");
  });
});
