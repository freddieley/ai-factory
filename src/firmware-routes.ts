import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { createArtifact, getProject, listArtifacts } from "./db.js";
import { generateFirmwareProject, FirmwareProject, FirmwareTarget } from "./firmware.js";

export function registerFirmwareRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/firmware/generate", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    try {
      const body = request.body as { architecture?: unknown; target?: unknown };
      if (!body?.architecture) return reply.code(400).send({ error: "architecture is required" });
      if (!body?.target) return reply.code(400).send({ error: "target is required" });
      const target = FirmwareTarget.parse(body.target);
      const project = generateFirmwareProject(body.architecture, target);
      const contentHash = createHash("sha256").update(JSON.stringify(project)).digest("hex");
      const artifactId = createArtifact(id, undefined, "firmware_project", project.name, undefined, contentHash, {
        schema: project.schema,
        target: project.target,
        architectureHash: project.architectureHash,
        fileCount: project.files.length,
      });
      return { artifactId, contentHash, project };
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/projects/:id/firmware/projects", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    return listArtifacts(id).filter(artifact => (artifact as { kind?: string }).kind === "firmware_project");
  });
}

export function parseFirmwareProject(input: unknown): FirmwareProject { return FirmwareProject.parse(input); }
