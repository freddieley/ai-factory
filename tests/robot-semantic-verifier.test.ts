import { describe, expect, it } from "vitest";
import { verifyRobotDesignSemantics } from "../src/robot-semantic-verifier.js";

function designWithCircle(parameters: Record<string, unknown>) {
  return {
    schema: "ai-factory.robot-design/v1",
    name: "Semantic CAD test",
    mission: "Validate feature orientation",
    requirements: [{ id: "R1", description: "Create the test body", category: "mechanical", priority: "must" }],
    parts: [{ id: "BODY", name: "Body", material: "aluminium", manufacturingProcess: "CNC machining", geometry: {
      schema: "ai-factory.robot-geometry/v1", units: "mm", operations: [
        { id: "SK", op: "sketch", inputs: [], parameters: { plane: "XY" } },
        { id: "PROFILE", op: "rectangle", inputs: ["SK"], parameters: { widthMm: 50, heightMm: 25, centerX: 25, centerY: 12.5 } },
        { id: "SOLID", op: "extrude", inputs: ["PROFILE"], parameters: { distanceMm: 40 } },
        { id: "CUT", op: "circle", inputs: ["SOLID"], parameters },
      ], outputOperationId: "CUT",
    } }],
    joints: [], designRationale: [], unresolvedQuestions: [],
  };
}

describe("robot semantic verifier", () => {
  it("rejects circular cuts without an explicit plane", () => {
    const result = verifyRobotDesignSemantics(designWithCircle({ radiusMm: 5, centerX: 25, centerY: 20, throughAll: true }) as any);
    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toContain("must explicitly declare plane");
  });

  it("accepts an XZ through-hole and identifies the Y cut axis", () => {
    const result = verifyRobotDesignSemantics(designWithCircle({ plane: "XZ", axis: "Y", radiusMm: 5, centerX: 25, centerY: 20, throughAll: true }) as any);
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an axis that disagrees with the selected sketch plane", () => {
    const result = verifyRobotDesignSemantics(designWithCircle({ plane: "XZ", axis: "Z", radiusMm: 5, centerX: 25, centerY: 20, throughAll: true }) as any);
    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toContain("axis Z is inconsistent");
  });

  it("requires a bounded extent when a circular cut is not through-all", () => {
    const result = verifyRobotDesignSemantics(designWithCircle({ plane: "XY", throughAll: false, radiusMm: 5, centerX: 25, centerY: 12 }) as any);
    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toContain("positive extentMm");
  });
});
