import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/server.js";
import { createProject } from "../src/db.js";

describe("electronics engineering analysis API", () => {
  let projectId = "";
  beforeAll(async () => { await app.ready(); projectId = createProject("electronics-analysis-api", "test")!.id; });
  afterAll(async () => { await app.close(); });

  it("analyzes and persists a supplied architecture and verified selection", async () => {
    const architecture = {
      schema: "ai-factory.electronics-architecture/v1", name: "API analysis", requirements: [{ id: "R1", description: "12 V input maximum 5 A", value: 12, unit: "V", priority: "must" }],
      powerDomains: [{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["R1"] }], systemMaxCurrentA: 5,
      functionalBlocks: [{ id: "block-controller", type: "controller", name: "Control and compute", requirementIds: ["R1"] }], interfaces: [], openQuestions: [],
    };
    const candidate = { componentId: "mcu-1", partNumber: "MCU-1", name: "microcontroller", category: "microcontroller", lifecycle: "active", score: 100, matchedBlockTypes: ["controller"], electricalData: { voltageMinV: 9, voltageMaxV: 15, currentMaxA: 10, currentDrawA: 0.2, powerW: 1, thermalResistanceCPerW: 5, maximumOperatingTempC: 125 }, ruleFindings: [] };
    const selection = { schema: "ai-factory.electronics-component-selection/v1", architectureSchema: "ai-factory.electronics-architecture/v1", candidates: [candidate], selected: [candidate], rejectedCount: 0, blockingFindings: [], ruleCheck: { schema: "ai-factory.electronics-erc/v1", status: "pass", findings: [] } };
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/electronics/analysis`, payload: { architecture, selection } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ artifactId: expect.any(String), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), analysis: { schema: "ai-factory.electronics-engineering-analysis/v1", status: "fail" } });
    const list = await app.inject({ method: "GET", url: `/api/projects/${projectId}/electronics/analyses` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });
});
