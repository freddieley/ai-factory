import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { getProject, listArtifacts, createArtifact } from "./db.js";
import { listComponents } from "./knowledge.js";
import { ElectronicsArchitecture } from "./electronics.js";
import { selectElectronicsComponents } from "./electronics-selection.js";

export function registerElectronicsSelectionRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/electronics/components/select", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    try {
      const body = request.body as { architecture?: unknown; resultLimit?: number };
      if (!body?.architecture) return reply.code(400).send({ error: "architecture is required" });
      const architecture = ElectronicsArchitecture.parse(body.architecture);
      const selection = selectElectronicsComponents(architecture, listComponents(id), Number(body.resultLimit ?? 20));
      const contentHash = createHash("sha256").update(JSON.stringify(selection)).digest("hex");
      const artifactId = createArtifact(id, undefined, "electronics_component_selection", "Electronics component selection", undefined, contentHash, {
        schema: selection.schema,
        architectureSchema: selection.architectureSchema,
        selectedComponentIds: selection.selected.map(candidate => candidate.componentId),
        candidateCount: selection.candidates.length,
        blockingFindings: selection.blockingFindings,
      });
      return { artifactId, contentHash, selection };
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/projects/:id/electronics/component-selections", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    return listArtifacts(id).filter(artifact => (artifact as { kind?: string }).kind === "electronics_component_selection");
  });
}
