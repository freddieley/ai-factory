import { describe, expect, it } from "vitest";
import { canonicalRobotDesignJson, robotDesignHash, validateRobotDesign } from "../src/robot-design.js";

const design = {
  schema: "ai-factory.robot-design/v1",
  name: "Adaptive inspection rover",
  mission: "Traverse a structured indoor environment and inspect equipment without human teleoperation.",
  requirements: [
    { id: "REQ-1", description: "Traverse uneven surfaces", category: "performance", priority: "must", verificationMethod: "simulation" },
    { id: "REQ-2", description: "Carry a sensor payload", category: "functional", priority: "should", verificationMethod: "test" },
  ],
  parts: [{
    id: "chassis",
    name: "Monocoque chassis",
    material: "carbon-fibre composite",
    manufacturingProcess: "CNC machining and composite layup",
    geometry: {
      schema: "ai-factory.robot-geometry/v1",
      units: "mm",
      operations: [
        { id: "profile", op: "sketch", inputs: [], parameters: { plane: "XY" } },
        { id: "wall", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 3 } },
        { id: "mounts", op: "pattern", inputs: ["wall"], parameters: { count: 4, spacingMm: 40 } },
        { id: "edge", op: "fillet", inputs: ["mounts"], parameters: { radiusMm: 2 } },
      ],
      outputOperationId: "edge",
    },
    massKg: 0.42,
  }],
  joints: [],
  designRationale: ["The structure is generated as a model-authored feature graph rather than selected from a vehicle template."],
  unresolvedQuestions: ["Validate fatigue life under the final payload and terrain envelope."],
};

describe("model-authored robot design IR", () => {
  it("accepts arbitrary part topology and general CAD operations", () => {
    const result = validateRobotDesign(design);
    expect(result.schema).toBe("ai-factory.robot-design/v1");
    expect(result.parts[0].geometry.operations.map(operation => operation.op)).toEqual(["sketch", "extrude", "pattern", "fillet"]);
  });

  it("normalizes common model-generated parameter and joint aliases without changing geometry intent", () => {
    const result = validateRobotDesign({
      ...design,
      parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
        { id: "sk", op: "sketch", inputs: [], parameters: {} },
        { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { width: 300, height: 20 } },
        { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 2 } },
      ], outputOperationId: "solid" } }],
      joints: [{ id: "j1", parentPartId: "chassis", childPartId: "chassis", type: "bolted" }],
      designRationale: [{ description: "Generated from the requested mechanical objective." }],
    });
    expect(result.parts[0].geometry.operations[1].parameters.widthMm).toBe(300);
    expect(result.parts[0].geometry.operations[1].parameters.heightMm).toBe(20);
    expect(result.joints[0].type).toBe("fixed");
    expect(result.designRationale[0]).toBe("Generated from the requested mechanical objective.");
  });

  it("rejects dangling geometry references and self-joints", () => {
    expect(() => validateRobotDesign({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, outputOperationId: "missing" } }] })).toThrow("outputOperationId");
    expect(() => validateRobotDesign({ ...design, joints: [{ id: "j", parentPartId: "chassis", childPartId: "chassis", type: "fixed", parameters: {} }] })).toThrow("cannot connect a part to itself");
  });

  it("produces deterministic canonical serialization and hash", () => {
    expect(canonicalRobotDesignJson(design)).toBe(canonicalRobotDesignJson({ ...design, parts: [...design.parts].reverse() }));
    expect(robotDesignHash(design)).toBe(robotDesignHash(design));
  });
});
