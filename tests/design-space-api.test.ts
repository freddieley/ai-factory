import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/server.js";
import { createProject, listArtifacts } from "../src/db.js";
import { executeCapability, getCapability } from "../src/capabilities.js";

const model = {
  schema: "ai-factory.parametric-mechanical/v1",
  name: "bracket",
  units: "mm",
  parameters: [
    { name: "width", valueMm: 20, description: "Overall X dimension" },
    { name: "depth", valueMm: 30, description: "Overall Y dimension" },
    { name: "height", valueMm: 10, description: "Overall Z dimension" },
  ],
  features: [{ type: "box", name: "base", width: "width", depth: "depth", height: "height" }],
};

const designSpace = {
  variables: [{ parameter: "width", minMm: 10, maxMm: 20, stepMm: 5 }],
  constraints: [{ id: "minimum-width", parameter: "width", minMm: 15 }],
  objective: { parameter: "width", direction: "minimize" },
};

describe("design-space exploration factory surface", () => {
  it("is discoverable and executable without Fusion", async () => {
    expect(getCapability("ai_factory_explore_design_space")).toBeDefined();
    const result = await executeCapability("ai_factory_explore_design_space", { model, designSpace });
    expect(result).toMatchObject({ candidateCount: 2 });
    expect((result as { bestCandidate: { objectiveValueMm: number } }).bestCandidate.objectiveValueMm).toBe(15);
  });

  it("persists an auditable exploration artifact and returns the ranked candidates", async () => {
    const project = createProject(`design-space-${randomUUID()}`, "design-space API test") as { id: string };
    await app.ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/design-space/explore`,
        payload: { model, designSpace, resultLimit: 10 },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { artifactId: string; candidateCount: number; candidates: unknown[]; bestCandidate: { objectiveValueMm: number } };
      expect(body.artifactId).toEqual(expect.any(String));
      expect(body.candidateCount).toBe(2);
      expect(body.candidates).toHaveLength(2);
      expect(body.bestCandidate.objectiveValueMm).toBe(15);

      const artifacts = listArtifacts(project.id) as Array<{ id: string; kind: string; content_hash: string | null; metadata: string }>;
      const artifact = artifacts.find(item => item.id === body.artifactId);
      expect(artifact?.kind).toBe("design_space_exploration");
      expect(artifact?.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(artifact?.metadata ?? "{}")).toMatchObject({ candidateCount: 2 });

      const list = await app.inject({ method: "GET", url: `/api/projects/${project.id}/design-space/explorations` });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
