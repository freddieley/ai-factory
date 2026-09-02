import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { getProject, listArtifacts, createArtifact } from "./db.js";
import { ElectronicsArchitecture } from "./electronics.js";
import { ElectronicsComponentSelection } from "./electronics-selection.js";
import { analyzeElectronicsEngineering } from "./electronics-analysis.js";

export function registerElectronicsAnalysisRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/electronics/analysis", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    try {
      const body = request.body as { architecture?: unknown; selection?: unknown };
      if (!body?.architecture) return reply.code(400).send({ error: "architecture is required" });
      if (!body?.selection) return reply.code(400).send({ error: "selection is required" });
      const architecture = ElectronicsArchitecture.parse(body.architecture);
      const selection = ElectronicsComponentSelection.parse(body.selection);
      const analysis = analyzeElectronicsEngineering(architecture, selection);
      const contentHash = createHash("sha256").update(JSON.stringify(analysis)).digest("hex");
      const artifactId = createArtifact(id, undefined, "electronics_engineering_analysis", "Electronics power, thermal, signal-integrity, and interface analysis", undefined, contentHash, {
        schema: analysis.schema,
        status: analysis.status,
        findingCount: analysis.findings.length,
        powerRailCount: analysis.power.length,
        thermalComponentCount: analysis.thermal.length,
        signalIntegrityCount: analysis.signalIntegrity.length,
        interfaceCount: analysis.interfaces.length,
      });
      return { artifactId, contentHash, analysis };
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/projects/:id/electronics/analyses", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    return listArtifacts(id).filter(artifact => (artifact as { kind?: string }).kind === "electronics_engineering_analysis");
  });
}
