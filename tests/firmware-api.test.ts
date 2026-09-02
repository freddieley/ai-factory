import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/server.js";
import { createProject } from "../src/db.js";

describe("firmware generation API", () => {
  let projectId = "";
  beforeAll(async () => { await app.ready(); projectId = createProject("firmware-api", "test")!.id; });
  afterAll(async () => { await app.close(); });

  it("generates and persists a firmware project", async () => {
    const architecture = {
      schema: "ai-factory.electronics-architecture/v1", name: "API firmware", requirements: [{ id: "R1", description: "12 V input", value: 12, unit: "V", priority: "must" }],
      powerDomains: [{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["R1"] }],
      functionalBlocks: [{ id: "block-controller", type: "controller", name: "Control and compute", requirementIds: ["R1"] }], interfaces: [], openQuestions: [],
    };
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/firmware/generate`, payload: { architecture, target: { name: "api-board", architecture: "portable-cpp", board: "generic" } } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ artifactId: expect.any(String), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), project: { schema: "ai-factory.firmware-project/v1", target: { board: "generic" } } });
    const list = await app.inject({ method: "GET", url: `/api/projects/${projectId}/firmware/projects` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });
});
