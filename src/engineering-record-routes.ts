import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getProject } from "./db.js";
import { EngineeringFactKind } from "./engineering.js";
import { listEngineeringFacts, listRequirementRevisions, recordEngineeringFact } from "./engineering-db.js";

const FactRequest=z.object({kind:EngineeringFactKind,key:z.string().min(1),statement:z.string().min(1),value:z.unknown().default(null),supersedesId:z.string().optional()});

export async function registerEngineeringRecordRoutes(app:FastifyInstance){
  app.get("/api/projects/:id/engineering-facts",async(request,reply)=>{const {id}=request.params as {id:string};if(!getProject(id))return reply.code(404).send({error:"project not found"});const {kind}=request.query as {kind?:string};if(kind!==undefined&&!EngineeringFactKind.safeParse(kind).success)return reply.code(400).send({error:"invalid engineering fact kind"});return listEngineeringFacts(id,kind as Parameters<typeof listEngineeringFacts>[1]);});
  app.post("/api/projects/:id/engineering-facts",async(request,reply)=>{const {id}=request.params as {id:string};if(!getProject(id))return reply.code(404).send({error:"project not found"});const parsed=FactRequest.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid engineering fact",issues:parsed.error.issues});return {id:recordEngineeringFact(id,parsed.data.kind,parsed.data.key,parsed.data.statement,parsed.data.value,parsed.data.supersedesId)};});
  app.get("/api/projects/:id/requirement-revisions",async(request,reply)=>{const {id}=request.params as {id:string};if(!getProject(id))return reply.code(404).send({error:"project not found"});const {requirementId}=request.query as {requirementId?:string};return listRequirementRevisions(id,requirementId);});
}
