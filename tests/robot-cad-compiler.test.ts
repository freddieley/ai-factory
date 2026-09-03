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

  it("registers extrusion results by operation id so downstream transforms can reference them", () => {
    const result = compileRobotDesignToFusionScript(design);
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain('refs["solid"] = body');
    expect(result.script).toContain('pendingTransforms.get("solid")');
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

  it("compiles circles after an extrusion as subtractive hole cuts", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: { plane: "XY" } },
      { id: "plate", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 100, heightMm: 60, centerX: 0, centerY: 0 } },
      { id: "solid", op: "extrude", inputs: ["plate"], parameters: { distanceMm: 5 } },
      { id: "hole", op: "circle", inputs: ["solid"], parameters: { radiusMm: 3, centerX: -40, centerY: -20 } },
    ], outputOperationId: "hole" } }] });
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("holeSketch = sketches.add(component.xYConstructionPlane)");
    expect(result.script).toContain("adsk.fusion.FeatureOperations.CutFeatureOperation");
    expect(result.script).toContain("cutExtrusion = features.extrudeFeatures.add(cutInput)");
    expect(result.script).toContain('refs["hole"] = refs["solid"]');
    expect(result.script).toContain("holeCount = holeCount + 1");
    expect(result.script).not.toContain('refs["hole"] = holeSketch');
  });

  it("uses the Fusion occurrence transform API for placement", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: {} },
      { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 150, heightMm: 20, centered: true } },
      { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 3 } },
      { id: "placed", op: "transform", inputs: ["solid"], parameters: { rotationDeg: 90, translateXmm: 10, translateYmm: 20 } },
    ], outputOperationId: "placed" } }] });
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("occurrence = root.occurrences.addNewComponent");
    expect(result.script).toContain("occurrence.transform2 = matrix");
    expect(result.script).not.toContain("body.transformBy(matrix)");
    expect(result.script).toContain("setToRotation");
    expect(result.script).toContain('refs["placed"] = refs["solid"]');
  });

  it("supports a transform emitted before extrusion and translateX aliases", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: {} },
      { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 150, heightMm: 20 } },
      { id: "place", op: "transform", inputs: ["profile"], parameters: { rotateDeg: 45, translateX: -75, translateY: 25 } },
      { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 3 } },
    ], outputOperationId: "solid" } }] });
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("pendingTransforms[\"profile\"]");
    expect(result.script).toContain("-7.5");
    expect(result.script).toContain("2.5");
  });

  it("compiles model-generated nested sketch profiles", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: { operations: [
        { id: "arm", op: "rectangle", inputs: [], parameters: { widthMm: 300, heightMm: 15, centerX: 0, centerY: 0, rotationDeg: 45 } },
        { id: "hub", op: "circle", inputs: [], parameters: { radiusMm: 30, centerX: 0, centerY: 0 } },
      ] } },
      { id: "solid", op: "extrude", inputs: ["sk"], parameters: { distanceMm: 2 } },
    ], outputOperationId: "solid" } }] });
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("Point3D.create");
    expect(result.script).toContain("sketchCircles.addByCenterRadius");
    expect(result.script).toContain("1.5");
  });

  it("uses one primary non-circle extrusion profile so sketch holes are not emitted as solid cylinders", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: {} },
      { id: "plate", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 100, heightMm: 60, centerX: 50, centerY: 30 } },
      { id: "h1", op: "circle", inputs: ["sk"], parameters: { radiusMm: 3, centerX: 10, centerY: 10 } },
      { id: "h2", op: "circle", inputs: ["sk"], parameters: { radiusMm: 3, centerX: 90, centerY: 10 } },
      { id: "h3", op: "circle", inputs: ["sk"], parameters: { radiusMm: 3, centerX: 10, centerY: 50 } },
      { id: "h4", op: "circle", inputs: ["sk"], parameters: { radiusMm: 3, centerX: 90, centerY: 50 } },
      { id: "solid", op: "extrude", inputs: ["plate", "h1", "h2", "h3", "h4"], parameters: { distanceMm: 5 } },
    ], outputOperationId: "solid" } }] });
    expect(result.unsupportedOperations).toEqual([]);
    expect(result.script).toContain("profile = profiles.item(0)");
    expect(result.script).not.toContain("for profileIndex in range(profiles.count)");
    expect(result.script.match(/extrudeFeatures\.createInput/g)?.length).toBe(1);
  });

  it("rejects disconnected geometry operations instead of executing geometry that is not part of the output", () => {
    expect(() => compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: {} },
      { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 120, heightMm: 80 } },
      { id: "solid", op: "extrude", inputs: ["profile"], parameters: { distanceMm: 4 } },
      { id: "orphan", op: "transform", inputs: ["profile"], parameters: { translateX: 10 } },
    ], outputOperationId: "solid" } }] })).toThrow("disconnected operations");
  });

  it("decodes MCP text content instead of regexing JSON-escaped newlines", () => {
    const result = extractFusionToolText({ content: [{ type: "text", text: "AI_FACTORY_ROBOT_CAD_RESULT\ndesign_hash=abc123\ndocument=Drone\nparts=7\nbodies=7" }] });
    expect(result).toContain("design_hash=abc123\ndocument=Drone");
    expect(result).toContain("parts=7\nbodies=7");
  });

  it("decodes the real Fusion MCP message response shape", () => {
    const result = extractFusionToolText({ message: "AI_FACTORY_ROBOT_CAD_RESULT\ndesign_hash=abc123\ndocument=Untitled\nparts=6\nbodies=6\n", success: true });
    expect(result).toContain("design_hash=abc123");
    expect(result).toContain("parts=6");
  });

  it("refuses unsupported operations instead of silently substituting geometry", () => {
    const result = compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [{ id: "s", op: "sweep", inputs: [], parameters: {} }], outputOperationId: "s" } }] });
    expect(result.unsupportedOperations).toContain("body:s:sweep");
    expect(result.script).not.toContain("createBox");
  });

  it("rejects cyclic operation graphs before generating executable CAD", () => {
    expect(() => compileRobotDesignToFusionScript({ ...design, parts: [{ ...design.parts[0], geometry: { ...design.parts[0].geometry, operations: [
      { id: "a", op: "transform", inputs: ["b"], parameters: {} },
      { id: "b", op: "transform", inputs: ["a"], parameters: {}, },
    ], outputOperationId: "a" } }] })).toThrow("contains a cycle");
  });
});
