import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { getProject, listArtifacts, createArtifact } from "./db.js";
import { listRequirements } from "./engineering-db.js";
import { ElectronicsRequirement, buildRequirementsDrivenElectronicsArchitecture } from "./electronics.js";

export function registerElectronicsRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/electronics/architecture", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });

    try {
      const electricalRequirements = listRequirements(id)
        .filter(requirement => String((requirement as { category?: unknown }).category ?? "").toLowerCase() === "electrical")
        .map(requirement => ElectronicsRequirement.parse({
          id: String((requirement as { id: unknown }).id),
          description: String((requirement as { description: unknown }).description),
          value: (requirement as { value?: unknown }).value === undefined ? null : (requirement as { value?: unknown }).value as string | number | null,
          unit: (requirement as { unit?: unknown }).unit === undefined ? null : String((requirement as { unit?: unknown }).unit),
          priority: String((requirement as { priority?: unknown }).priority ?? "should"),
          verificationMethod: (requirement as { verification_method?: unknown }).verification_method == null ? null : String((requirement as { verification_method?: unknown }).verification_method),
        }));
      if (electricalRequirements.length === 0) return reply.code(400).send({ error: "project has no electrical requirements" });

      const architecture = buildRequirementsDrivenElectronicsArchitecture(electricalRequirements);
      const contentHash = createHash("sha256").update(JSON.stringify(architecture)).digest("hex");
      const artifactId = createArtifact(id, undefined, "electronics_architecture", architecture.name, undefined, contentHash, {
        schema: architecture.schema,
        requirementIds: architecture.requirements.map(requirement => requirement.id),
        powerDomains: architecture.powerDomains,
        functionalBlocks: architecture.functionalBlocks,
        interfaces: architecture.interfaces,
        openQuestions: architecture.openQuestions,
      });
      return { artifactId, contentHash, architecture };
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/projects/:id/electronics/architectures", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    return listArtifacts(id).filter(artifact => (artifact as { kind?: string }).kind === "electronics_architecture");
  });
}
