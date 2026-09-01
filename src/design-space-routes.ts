import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { createArtifact, getProject, listArtifacts } from "./db.js";
import { DesignSpace, exploreDesignSpace } from "./design-space.js";
import { validateParametricModel } from "./parametric.js";
import { z } from "zod";

const ExplorationRequest = z.object({
  model: z.unknown(),
  designSpace: DesignSpace,
  resultLimit: z.number().int().positive().max(1_000).default(25),
});

function resultHash(result: unknown): string {
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}

export function registerDesignSpaceRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/design-space/explore", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });

    try {
      const input = ExplorationRequest.parse(request.body);
      const model = validateParametricModel(input.model);
      const candidates = exploreDesignSpace(model, input.designSpace);
      const result = {
        schema: "ai-factory.design-space-result/v1",
        model,
        designSpace: input.designSpace,
        candidateCount: candidates.length,
        candidates,
      };
      const contentHash = resultHash(result);
      const artifactId = createArtifact(
        id,
        undefined,
        "design_space_exploration",
        `${model.name}-design-space-exploration`,
        undefined,
        contentHash,
        {
          schema: result.schema,
          candidateCount: candidates.length,
          objective: input.designSpace.objective,
          variables: input.designSpace.variables,
          constraints: input.designSpace.constraints,
          bestCandidate: candidates[0] ?? null,
          topCandidates: candidates.slice(0, input.resultLimit),
        },
      );

      return {
        artifactId,
        contentHash,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, input.resultLimit),
        bestCandidate: candidates[0] ?? null,
      };
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/projects/:id/design-space/explorations", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    return listArtifacts(id).filter(artifact => (artifact as { kind?: string }).kind === "design_space_exploration");
  });
}
