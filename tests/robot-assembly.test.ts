import { describe, expect, it } from "vitest";
import { compileRobotDesignToFusionScript } from "../src/robot-cad-compiler.js";

function part(id: string) {
  return {
    id,
    name: id,
    material: "aluminium",
    manufacturingProcess: "CNC machining",
    geometry: {
      schema: "ai-factory.robot-geometry/v1",
      units: "mm",
      operations: [
        { id: `${id}-sk`, op: "sketch", inputs: [], parameters: { plane: "XY" } },
        { id: `${id}-profile`, op: "rectangle", inputs: [`${id}-sk`], parameters: { widthMm: 20, heightMm: 20 } },
        { id: `${id}-solid`, op: "extrude", inputs: [`${id}-profile`], parameters: { distanceMm: 5 } },
      ],
      outputOperationId: `${id}-solid`,
    },
  };
}

const design = {
  schema: "ai-factory.robot-design/v1",
  name: "Jointed assembly",
  mission: "Verify deterministic assembly joint generation.",
  requirements: [{ id: "R1", description: "Connect two components", category: "mechanical", priority: "must" }],
  parts: [part("base"), part("arm")],
  joints: [{
    id: "arm-pivot",
    parentPartId: "base",
    childPartId: "arm",
    type: "revolute",
    parameters: { anchorXmm: 10, anchorYmm: 5, axis: "Z", minimum: -1.57, maximum: 1.57 },
  }],
  designRationale: ["The assembly relationship is authored as a revolute joint rather than inferred from a template."],
  unresolvedQuestions: [],
};

describe("model-authored assembly joints", () => {
  it("compiles a revolute joint between named part occurrences", () => {
    const result = compileRobotDesignToFusionScript(design);
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("occurrence.name = \"base\"");
    expect(result.script).toContain("occurrence.name = \"arm\"");
    expect(result.script).toContain("root.joints.createInput(parentJointGeo0, childJointGeo0)");
    expect(result.script).toContain("jointInput0.setAsRevoluteJointMotion(adsk.fusion.JointDirections.ZAxisJointDirection)");
    expect(result.script).toContain("limits0.minimumValue = -1.57");
    expect(result.script).toContain("limits0.maximumValue = 1.57");
    expect(result.script).toContain("print('joints=' + str(actualJoints))");
  });

  it("rejects unsupported non-zero Z joint anchors instead of silently losing placement", () => {
    const invalid = {
      ...design,
      joints: [{ ...design.joints[0], parameters: { anchorXmm: 10, anchorYmm: 5, anchorZmm: 4, axis: "Z" } }],
    };
    const result = compileRobotDesignToFusionScript(invalid);
    expect(result.unsupportedOperations).toContain("joint:arm-pivot:anchorZ-not-supported-by-sketch-point");
  });
});
