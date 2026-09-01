import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { getProject, listArtifacts, createArtifact } from "./db.js";
import { readKiCadValidationReports, validateKiCadDesign } from "./kicad.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function registerKiCadRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/electronics/kicad/validate", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      const result = await validateKiCadDesign({
        schematicPath: typeof body.schematicPath === "string" ? body.schematicPath : undefined,
        pcbPath: typeof body.pcbPath === "string" ? body.pcbPath : undefined,
        exportNetlist: body.exportNetlist === true,
      });
      const reports = await readKiCadValidationReports(result);
      const content = { result, reports };
      const artifactId = createArtifact(id, undefined, "electronics_eda_validation", "KiCad ERC/DRC validation", undefined, hash(content), {
        schema: result.schema,
        toolVersion: result.toolVersion,
        schematic: result.schematic,
        pcb: result.pcb,
        netlist: result.netlist,
        reports,
      });
      return { artifactId, contentHash: hash(content), ...content };
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/projects/:id/electronics/kicad/validations", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProject(id)) return reply.code(404).send({ error: "project not found" });
    return listArtifacts(id).filter(artifact => (artifact as { kind?: string }).kind === "electronics_eda_validation");
  });
}
