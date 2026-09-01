import type { FastifyInstance } from "fastify";
import { getProject, getArtifact } from "./db.js";
import { ImpactSeverity, addReviewFinding, analyzeChangeImpact, createDesignReview, decideDesignReview, getDesignReview, getImpactAnalysis, linkRequirementArtifact, listDesignReviews, listImpactAnalyses, listRequirementArtifactLinks } from "./design-review.js";

export async function registerDesignReviewRoutes(app: FastifyInstance) {
  app.get("/api/projects/:id/impact-analyses", async (request, reply) => {
    const { id } = request.params as { id:string };
    if (!getProject(id)) return reply.code(404).send({error:"project not found"});
    return listImpactAnalyses(id);
  });
  app.get("/api/impact-analyses/:id", async (request, reply) => {
    const { id } = request.params as { id:string };
    const result = getImpactAnalysis(id);
    if (!result) return reply.code(404).send({error:"impact analysis not found"});
    return result;
  });
  app.post("/api/projects/:id/impact-analyses", async (request, reply) => {
    const { id } = request.params as { id:string };
    if (!getProject(id)) return reply.code(404).send({error:"project not found"});
    const body = request.body as {artifactId?:string};
    if (!body?.artifactId) return reply.code(400).send({error:"artifactId is required"});
    try { return analyzeChangeImpact(id, body.artifactId); } catch (error) { return reply.code(400).send({error:String(error)}); }
  });
  app.get("/api/projects/:id/requirement-artifact-links", async (request, reply) => {
    const { id } = request.params as {id:string};
    if (!getProject(id)) return reply.code(404).send({error:"project not found"});
    return listRequirementArtifactLinks(id);
  });
  app.post("/api/projects/:id/requirement-artifact-links", async (request, reply) => {
    const { id } = request.params as {id:string};
    if (!getProject(id)) return reply.code(404).send({error:"project not found"});
    const body = request.body as {requirementId?:string;artifactId?:string;relation?:string};
    if (!body?.requirementId || !body?.artifactId) return reply.code(400).send({error:"requirementId and artifactId are required"});
    const artifact = getArtifact(body.artifactId) as {project_id:string}|undefined;
    if (!artifact || artifact.project_id !== id) return reply.code(400).send({error:"artifact not found in project"});
    try { linkRequirementArtifact(body.requirementId, body.artifactId, body.relation ?? "satisfies"); return {ok:true}; } catch (error) { return reply.code(400).send({error:String(error)}); }
  });
  app.get("/api/projects/:id/design-reviews", async (request, reply) => {
    const { id } = request.params as {id:string};
    if (!getProject(id)) return reply.code(404).send({error:"project not found"});
    return listDesignReviews(id);
  });
  app.get("/api/design-reviews/:id", async (request, reply) => {
    const { id } = request.params as {id:string};
    const result = getDesignReview(id);
    if (!result) return reply.code(404).send({error:"design review not found"});
    return result;
  });
  app.post("/api/projects/:id/design-reviews", async (request, reply) => {
    const { id } = request.params as {id:string};
    if (!getProject(id)) return reply.code(404).send({error:"project not found"});
    const body = request.body as {triggerType?:string;triggerRef?:string;impactAnalysisId?:string};
    if (!body?.triggerType) return reply.code(400).send({error:"triggerType is required"});
    try { return {id:createDesignReview(id,body.triggerType,body.triggerRef,body.impactAnalysisId)}; } catch (error) { return reply.code(400).send({error:String(error)}); }
  });
  app.post("/api/design-reviews/:id/findings", async (request, reply) => {
    const { id } = request.params as {id:string};
    const body = request.body as {severity?:string;title?:string;detail?:string};
    if (!body?.severity || !ImpactSeverity.includes(body.severity as typeof ImpactSeverity[number]) || !body.title || !body.detail) return reply.code(400).send({error:"severity (info, warning, or critical), title, and detail are required"});
    try { return {id:addReviewFinding(id,body.severity as typeof ImpactSeverity[number],body.title,body.detail)}; } catch (error) { return reply.code(400).send({error:String(error)}); }
  });
  app.post("/api/design-reviews/:id/decision", async (request, reply) => {
    const { id } = request.params as {id:string};
    const body = request.body as {decision?:string;decidedBy?:string};
    if (!body?.decision || !["approved","rejected"].includes(body.decision) || !body.decidedBy) return reply.code(400).send({error:"decision (approved or rejected) and decidedBy are required"});
    try { return decideDesignReview(id,body.decision as "approved"|"rejected",body.decidedBy); } catch (error) { return reply.code(409).send({error:String(error)}); }
  });
}
