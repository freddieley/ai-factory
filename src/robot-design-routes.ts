import { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { compileRobotDesignToFusion, compileRobotDesignToFusionScript } from "./robot-cad-compiler.js";
import { getProject, listArtifacts, createArtifact } from "./db.js";
import { robotDesignHash, validateRobotDesign } from "./robot-design.js";

export function registerRobotDesignRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/robot-design/compile", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });

    const body = request.body as { design?: unknown; execute?: boolean };
    if (body?.design === undefined) return reply.code(400).send({ error: "design is required" });

    try {
      const design = validateRobotDesign(body.design);
      const designHash = robotDesignHash(design);
      const designArtifactId = createArtifact(id, undefined, "robot_design", design.name, undefined, designHash, {
        schema: design.schema,
        designHash,
        mission: design.mission,
        partIds: design.parts.map(part => part.id),
        jointIds: design.joints.map(joint => joint.id),
        requirementIds: design.requirements.map(requirement => requirement.id),
      });

      if (body.execute === false) {
        const compiled = compileRobotDesignToFusionScript(design);
        const compileHash = createHash("sha256").update(compiled.script).digest("hex");
        const compileArtifactId = createArtifact(id, designArtifactId, "robot_cad_compile", `${design.name} CAD compilation`, undefined, compileHash, {
          schema: "ai-factory.robot-cad-compile/v1",
          designHash: compiled.designHash,
          success: compiled.unsupportedOperations.length === 0,
          unsupportedOperations: compiled.unsupportedOperations,
        });
        return reply.send({ ...compiled, schema: design.schema, artifactId: compileArtifactId, designArtifactId, compileHash });
      }

      const result = await compileRobotDesignToFusion(design);
      const compileHash = createHash("sha256").update(JSON.stringify(result)).digest("hex");
      const compileArtifactId = createArtifact(id, designArtifactId, "robot_cad_compile", `${design.name} CAD compilation`, undefined, compileHash, {
        ...result,
        designArtifactId,
      });
      return reply.send({ ...result, schema: design.schema, artifactId: compileArtifactId, designArtifactId, compileHash });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/projects/:id/robot-designs", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    return listArtifacts(id).filter(artifact => (artifact as { kind?: string }).kind === "robot_design");
  });

  app.get("/api/projects/:id/robot-design/compilations", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    return listArtifacts(id).filter(artifact => (artifact as { kind?: string }).kind === "robot_cad_compile");
  });
}
