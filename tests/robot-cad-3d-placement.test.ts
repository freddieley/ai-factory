import { describe, expect, it } from "vitest";
import { compileRobotDesignToFusionScript } from "../src/robot-cad-compiler.js";

const baseDesign = {
  schema: "ai-factory.robot-design/v1",
  name: "3D placement regression",
  mission: "Verify that model-authored components can be placed vertically in an assembly.",
  requirements: [{ id: "R1", description: "Support a three-dimensional component placement", category: "mechanical", priority: "must" }],
  parts: [{
    id: "support",
    name: "Support",
    material: "aluminium",
    manufacturingProcess: "CNC machining",
    geometry: {
      schema: "ai-factory.robot-geometry/v1",
      units: "mm",
      operations: [
        { id: "sk", op: "sketch", inputs: [], parameters: { plane: "XY" } },
        { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 20, heightMm: 20 } },
        { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 5 } },
        { id: "placed", op: "transform", inputs: ["solid"], parameters: { translateXmm: 10, translateYmm: 20, translateZmm: -15, rotationDeg: 90 } },
      ],
      outputOperationId: "placed",
    },
  }],
  joints: [],
  designRationale: [],
  unresolvedQuestions: [],
};

describe("robot CAD 3D placement", () => {
  it("emits model-authored Z translation through the Fusion occurrence transform", () => {
    const result = compileRobotDesignToFusionScript(baseDesign);
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("matrix.translation = adsk.core.Vector3D.create(1,2,-1.5)");
    expect(result.script).toContain("occurrence.transform2 = matrix");
  });

  it("supports Z translation when a transform precedes extrusion", () => {
    const design = {
      ...baseDesign,
      parts: [{ ...baseDesign.parts[0], geometry: {
        ...baseDesign.parts[0].geometry,
        operations: [
          { id: "sk", op: "sketch", inputs: [], parameters: { plane: "XY" } },
          { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 20, heightMm: 20 } },
          { id: "place", op: "transform", inputs: ["profile"], parameters: { translateXmm: 10, translateYmm: 20, translateZmm: -15 } },
          { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 5 } },
        ],
        outputOperationId: "solid",
      } }],
    };
    const result = compileRobotDesignToFusionScript(design);
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("rotationDeg, tx, ty, tz = pending");
    expect(result.script).toContain("matrix.translation = adsk.core.Vector3D.create(tx,ty,tz)");
  });
});
