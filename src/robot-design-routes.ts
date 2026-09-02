import { FastifyInstance } from "fastify";
import { compileRobotDesignToFusion, compileRobotDesignToFusionScript } from "./robot-cad-compiler.js";

export function registerRobotDesignRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/robot-design/compile", async (request, reply) => {
    const body = request.body as { design?: unknown; execute?: boolean };
    if (body?.design === undefined) return reply.code(400).send({ error: "design is required" });
    if (body.execute === false) return reply.send(compileRobotDesignToFusionScript(body.design));
    return reply.send(await compileRobotDesignToFusion(body.design));
  });
}
