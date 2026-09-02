import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/server.js";
import { createProject } from "../src/db.js";
import { addComponent } from "../src/knowledge.js";

const architecture = {
  schema: "ai-factory.electronics-architecture/v1",
  name: "API architecture",
  requirements: [{ id: "R1", description: "12 V input", value: 12, unit: "V", priority: "must" }],
  powerDomains: [{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["R1"] }],
  systemMaxCurrentA: 5,
  functionalBlocks: [{ id: "block-controller", type: "controller", name: "Control and compute", requirementIds: ["R1"] }],
  interfaces: [],
  openQuestions: [],
};

describe("electronics component selection API", () => {
  let projectId = "";
  beforeAll(async () => {
    await app.ready();
    projectId = createProject("electronics-selection-api", "test")!.id;
    addComponent(projectId, { partNumber: "MCU-API", name: "12V microcontroller", manufacturer: "Example", category: "microcontroller", lifecycle: "active", voltageMinV: 9, voltageMaxV: 15, currentMaxA: 10 });
  });
  afterAll(async () => {
    await app.close();
  });

  it("selects, ERC-checks, and persists compatible components", async () => {
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/electronics/components/select`, payload: { architecture } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      artifactId: expect.any(String),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      selection: {
        schema: "ai-factory.electronics-component-selection/v1",
        selected: [{ partNumber: "MCU-API" }],
        ruleCheck: { schema: "ai-factory.electronics-erc/v1", status: "pass", findings: [] },
      },
    });
    const list = await app.inject({ method: "GET", url: `/api/projects/${projectId}/electronics/component-selections` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });
});
