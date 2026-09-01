import type { FastifyInstance } from "fastify";
import { getProject } from "./db.js";
import { addEvidenceClaim, addEvidenceSource, EvidenceClaim, EvidenceSource, getEvidenceFreshness, listEvidenceClaims, listEvidenceSources, searchEvidence } from "./evidence.js";

export async function registerEvidenceRoutes(app:FastifyInstance){
  app.get("/api/projects/:id/evidence",async(request,reply)=>{const {id}=request.params as {id:string};if(!getProject(id))return reply.code(404).send({error:"project not found"});return {sources:listEvidenceSources(id),claims:listEvidenceClaims(id),freshness:getEvidenceFreshness(id)};});
  app.get("/api/projects/:id/evidence/search",async(request,reply)=>{const {id}=request.params as {id:string};const {q}=request.query as {q?:string};if(!getProject(id))return reply.code(404).send({error:"project not found"});if(!q?.trim())return reply.code(400).send({error:"q is required"});return searchEvidence(id,q);});
  app.post("/api/projects/:id/evidence/sources",async(request,reply)=>{const {id}=request.params as {id:string};if(!getProject(id))return reply.code(404).send({error:"project not found"});try{return {id:addEvidenceSource(id,EvidenceSource.parse(request.body))};}catch(error){return reply.code(400).send({error:String(error)});}});
  app.post("/api/projects/:id/evidence/claims",async(request,reply)=>{const {id}=request.params as {id:string};if(!getProject(id))return reply.code(404).send({error:"project not found"});try{return {id:addEvidenceClaim(id,EvidenceClaim.parse(request.body))};}catch(error){return reply.code(400).send({error:String(error)});}});
}
