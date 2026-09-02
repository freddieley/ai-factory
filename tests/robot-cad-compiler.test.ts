import { describe, expect, it } from "vitest";
import { compileRobotDesignToFusionScript, extractFusionToolText } from "../src/robot-cad-compiler.js";

describe("robot CAD compiler", () => {
  const design = {
    schema: "ai-factory.robot-design/v1",
    name: "Freeform rover chassis",
    mission: "Inspect equipment indoors",
    requirements: [{ id: "R1", description: "Carry inspection payload", category: "functional", priority: "must" }],
    parts: [{ id: "body", name: "Custom chassis", material: "aluminium", manufacturingProcess: "CNC machining", geometry: { schema: "ai-factory.robot-geometry/v1", units: "mm", operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: { plane: "XY" } },
      { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 120, heightMm: 80, centered: true } },
      { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 4 } },
    ], outputOperationId: "solid" } }],
    joints: [], designRationale: [], unresolvedQuestions: [],
  };

  it("compiles a model-authored feature graph rather than a template", () => {
    const result = compileRobotDesignToFusionScript(design);
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.designHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.script).toContain("Custom chassis");
    expect(result.script).toContain("extrudeFeatures.createInput");
    expect(result.script).toContain("sketchLines.addByTwoPoints");
    expect(result.script).toContain("Point3D.create(-6,-4,0)");
    expect(result.script).not.toContain("executeCreateBox");
  });

  it("honors model-authored rectangle center and rotation", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: {} },
      { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 300, heightMm: 20, centerX: 150, centerY: -150, rotationDeg: 90 } },
      { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 3 } },
    ], outputOperationId: "solid" } }] });
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toMatch(/Point3D\.create\(15\.999999999999998,-30,0\)/);
    expect(result.script).toMatch(/Point3D\.create\(14\.000000000000002,6\.123233995736766e-17,0\)/);
  });

  it("accepts common model-generated dimension aliases and scalar circle centers", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: {} },
      { id: "profile", op: "circle", inputs: ["sk"], parameters: { center: "150,0", radius: 15 } },
      { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 4 } },
    ], outputOperationId: "solid" } }] });
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("Point3D.create(15,0,0), 1.5");
  });

  it("compiles a model-authored transform for a second crossing frame arm", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: {} },
      { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 300, heightMm: 20, centered: true } },
      { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 2 } },
      { id: "rotated", op: "transform", inputs: ["solid"], parameters: { rotationDeg: 90, translateXmm: 0, translateYmm: 0 } },
    ], outputOperationId: "rotated" } }] });
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("body.transformBy(matrix)");
    expect(result.script).toContain("setToRotation");
  });

  it("decodes MCP text content instead of regexing JSON-escaped newlines", () => {
    const result = extractFusionToolText({ content: [{ type: "text", text: "AI_FACTORY_ROBOT_CAD_RESULT\ndesign_hash=abc123\ndocument=Drone\nparts=7\nbodies=7" }] });
    expect(result).toContain("design_hash=abc123\ndocument=Drone");
    expect(result).toContain("parts=7\nbodies=7");
  });

  it("refuses unsupported operations instead of silently substituting geometry", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [{ id: "s", op: "sweep", inputs: [], parameters: {} }], outputOperationId: "s" } }] });
    expect(result.unsupportedOperations).toContain("body:s:sweep");
    expect(result.script).not.toContain("createBox");
  });

  it("rejects cyclic operation graphs before generating executable CAD", () => {
    expect(() => compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "a", op: "transform", inputs: ["b"], parameters: {} },
      { id: "b", op: "transform", inputs: ["a"], parameters: {} },
    ], outputOperationId: "a" } }] })).toThrow("contains a cycle");
  });
});
