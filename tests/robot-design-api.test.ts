import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/server.js";
import { createProject } from "../src/db.js";

describe("robot design API", () => {
  let projectId = "";
  beforeAll(async () => { await app.ready(); projectId = createProject("robot-design-api", "test")!.id; });
  afterAll(async () => { await app.close(); });

  const design = {
    schema: "ai-factory.robot-design/v1",
    name: "API rover",
    mission: "Inspect a test fixture",
    requirements: [{ id: "R1", description: "Carry inspection payload", category: "functional", priority: "must" }],
    parts: [{ id: "body", name: "Custom body", material: "aluminium", manufacturingProcess: "CNC machining", geometry: { schema: "ai-factory.robot-geometry/v1", units: "mm", operations: [
      { id: "sk", op: "sketch", inputs: [], parameters: { plane: "XY" } },
      { id: "profile", op: "rectangle", inputs: ["sk"], parameters: { widthMm: 100, heightMm: 60 } },
      { id: "solid", op: "extrude", inputs: ["sk"], parameters: { distanceMm: 4 } },
    ], outputOperationId: "solid" } }],
    joints: [], designRationale: ["Low part count for the first prototype"], unresolvedQuestions: [],
  };

  it("validates, compiles without Fusion execution, and persists the design lineage", async () => {
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/robot-design/compile`, payload: { design, execute: false } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schema: "ai-factory.robot-design/v1",
      designHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      unsupportedOperations: [],
      artifactId: expect.any(String),
      designArtifactId: expect.any(String),
      compileHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const designs = await app.inject({ method: "GET", url: `/api/projects/${projectId}/robot-designs` });
    expect(designs.statusCode).toBe(200);
    expect(designs.json()).toHaveLength(1);
    expect(designs.json()[0].kind).toBe("robot_design");

    const compilations = await app.inject({ method: "GET", url: `/api/projects/${projectId}/robot-design/compilations` });
    expect(compilations.statusCode).toBe(200);
    expect(compilations.json()).toHaveLength(1);
    expect(compilations.json()[0].kind).toBe("robot_cad_compile");
  });

  it("rejects an invalid model design before compilation", async () => {
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/robot-design/compile`, payload: { design: { ...design, parts: [] }, execute: false } });
    expect(response.statusCode).toBe(400);
  });
});
