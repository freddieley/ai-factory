import type { FastifyInstance } from "fastify";
import { getProject } from "./db.js";
import { StageName, StageStatus } from "./lifecycle.js";
import { getProjectStage, initializeProjectStages, listProjectStages, transitionProjectStage } from "./lifecycle-db.js";

export async function registerLifecycleRoutes(app: FastifyInstance) {
  app.get("/api/projects/:id/stages", async (request, reply) => {
    const { id } = request.params as { id: string }; if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    const stages = listProjectStages(id); if (stages.length === 0) initializeProjectStages(id); return listProjectStages(id);
  });
  app.post("/api/projects/:id/stages/initialize", async (request, reply) => {
    const { id } = request.params as { id: string }; if (!getProject(id)) return reply.code(404).send({ error: "project not found" }); return initializeProjectStages(id);
  });
  app.get("/api/projects/:id/stages/:stage", async (request, reply) => {
    const { id, stage: rawStage } = request.params as { id: string; stage: string }; if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    const parsed = StageName.safeParse(rawStage); if (!parsed.success) return reply.code(400).send({ error: "invalid stage" });
    const stage = getProjectStage(id, parsed.data); if (!stage) return reply.code(404).send({ error: "stage not initialized" }); return stage;
  });
  app.patch("/api/projects/:id/stages/:stage", async (request, reply) => {
    const { id, stage: rawStage } = request.params as { id: string; stage: string }; if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    const parsedStage = StageName.safeParse(rawStage); if (!parsedStage.success) return reply.code(400).send({ error: "invalid stage" });
    const body = request.body as { status?: string; runId?: string; approvalId?: string; error?: string };
    const parsedStatus = StageStatus.safeParse(body?.status); if (!parsedStatus.success) return reply.code(400).send({ error: "invalid status" });
    try { return transitionProjectStage(id, parsedStage.data, parsedStatus.data, { runId: body.runId, approvalId: body.approvalId, error: body.error }); }
    catch (error) { return reply.code(400).send({ error: String(error) }); }
  });
}
