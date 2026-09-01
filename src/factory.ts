import { z } from "zod";
import { createFactoryCycle, finishFactoryCycle, addCycleEvent, listEvents, getFactoryCycle, listCycleEvents } from "./db.js";
import { runAgent } from "./agent.js";
import { generateEngineeringPlan } from "./planning.js";
import { initializeProjectStages, transitionProjectStage } from "./lifecycle-db.js";

export const FactoryRequest=z.object({projectId:z.string().min(1),objective:z.string().min(1),constraints:z.array(z.string()).default([]),maxIterations:z.number().int().min(1).max(5).default(2)});
export type FactoryRequest=z.infer<typeof FactoryRequest>;
export const FactoryFollowUpRequest=z.object({cycleId:z.string().min(1),message:z.string().min(1)});
export type FactoryFollowUpRequest=z.infer<typeof FactoryFollowUpRequest>;
type EventRow={type:string;payload:string};
function hasVerifiedToolResult(events:EventRow[]){return events.some(event=>{if(event.type!=="tool.result")return false;try{const payload=JSON.parse(event.payload) as {result?:{success?:boolean}};return payload.result?.success===true;}catch{return false;}});}
function hasUnresolvedCondition(output:string){return /not verified|unable to|failed|error|unmet|cannot|blocked|needs review/i.test(output);}
function planRequiresApproval(plan:Awaited<ReturnType<typeof generateEngineeringPlan>>["plan"]){return plan.steps.some(step=>step.requiresApproval||step.operationClass==="manufacture");}
function parseConstraints(value:unknown):string[]{if(Array.isArray(value))return value.filter((item):item is string=>typeof item==="string");if(typeof value==="string"){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==="string"):[];}catch{return [];}}return [];}
function conversationContext(cycleId:string){return listCycleEvents(cycleId).filter((event)=>["factory.conversation.user","factory.conversation.assistant"].includes(event.type)).map((event)=>{let payload:{message?:string};try{payload=JSON.parse(event.payload) as {message?:string};}catch{return null;}return payload.message?`${event.type.endsWith("user")?"User":"AI Factory"}: ${payload.message}`:null;}).filter((item):item is string=>Boolean(item)).join("\n\n");}

/** Run a bounded plan-first engineering cycle with a durable cycle identity. */
export async function runFactory(request:FactoryRequest){
  const normalized=FactoryRequest.parse(request);const cycleId=createFactoryCycle(normalized.projectId,normalized.objective,normalized.constraints);const results:unknown[]=[];initializeProjectStages(normalized.projectId);
  addCycleEvent(cycleId,"factory.cycle.started",{objective:normalized.objective,constraints:normalized.constraints,maxIterations:normalized.maxIterations});
  addCycleEvent(cycleId,"factory.conversation.user",{message:normalized.objective});
  try{
    transitionProjectStage(normalized.projectId,"requirements","passed");transitionProjectStage(normalized.projectId,"planning","running");addCycleEvent(cycleId,"factory.planning.started",{projectId:normalized.projectId});
    try{
      const planning=await generateEngineeringPlan(normalized.projectId,normalized.objective,normalized.constraints);addCycleEvent(cycleId,"factory.planning.completed",{planId:planning.plan.id,requirements:planning.plan.requirements.length,steps:planning.plan.steps.length,requiresApproval:planRequiresApproval(planning.plan)});transitionProjectStage(normalized.projectId,"planning","passed");transitionProjectStage(normalized.projectId,"design","ready");
    }catch(error){addCycleEvent(cycleId,"factory.planning.failed",{error:String(error)});transitionProjectStage(normalized.projectId,"planning","failed",{error:String(error)});finishFactoryCycle(cycleId,"needs_review");addCycleEvent(cycleId,"factory.cycle.completed",{status:"needs_review",reason:"Validated engineering planning failed; execution was not attempted."});addCycleEvent(cycleId,"factory.conversation.assistant",{message:`Planning could not be completed. ${String(error)}`});return {cycleId,status:"needs_review",iterations:results,error:String(error)};}
    for(let iteration=1;iteration<=normalized.maxIterations;iteration++){
      const prompt=iteration===1?`Execute the validated engineering plan for this project. Objective: ${normalized.objective}\nConstraints:\n${normalized.constraints.join("\n")||"None specified"}\nUse the saved engineering plan as the source of truth. Inspect the current Fusion state first. Make only the CAD changes required by the plan. Verify the resulting state with deterministic evidence. Do not manufacture, dispatch, or perform irreversible physical operations.`:`Iteration ${iteration} of a bounded CAD engineering loop. Re-open the current Fusion state, inspect the existing design against the saved engineering plan and objective, identify unmet requirements, make only necessary CAD corrections, and verify the resulting state with Fusion evidence. Objective: ${normalized.objective}\nConstraints:\n${normalized.constraints.join("\n")||"None specified"}\nDo not manufacture or dispatch anything.`;
      addCycleEvent(cycleId,"factory.iteration.started",{iteration});transitionProjectStage(normalized.projectId,"design","running");
      const result=await runAgent(normalized.projectId,prompt,cycleId);const events=listEvents(result.runId) as EventRow[];const verified=hasVerifiedToolResult(events);const unresolved=hasUnresolvedCondition(result.output??"");results.push({iteration,result,verification:{verified,unresolved}});addCycleEvent(cycleId,"factory.iteration.completed",{iteration,runId:result.runId,verified,unresolved,output:result.output});
      if(result.output)addCycleEvent(cycleId,"factory.conversation.assistant",{message:result.output});
      if(verified&&!unresolved){transitionProjectStage(normalized.projectId,"design","passed",{runId:result.runId});transitionProjectStage(normalized.projectId,"verification","running",{runId:result.runId});addCycleEvent(cycleId,"factory.verification.completed",{iteration,runId:result.runId,source:"deterministic tool result"});transitionProjectStage(normalized.projectId,"verification","passed",{runId:result.runId});transitionProjectStage(normalized.projectId,"simulation","skipped",{runId:result.runId});transitionProjectStage(normalized.projectId,"manufacturing","blocked",{runId:result.runId,error:"Manufacturing requires explicit approval and is outside this cycle."});finishFactoryCycle(cycleId,"completed");addCycleEvent(cycleId,"factory.cycle.completed",{status:"completed",iteration,reason:"Deterministic tool evidence confirmed a successful operation."});return {cycleId,status:"completed",iterations:results};}
      transitionProjectStage(normalized.projectId,"design","failed",{runId:result.runId,error:result.output});if(iteration<normalized.maxIterations)transitionProjectStage(normalized.projectId,"design","ready",{runId:result.runId});
    }
    finishFactoryCycle(cycleId,"needs_review");addCycleEvent(cycleId,"factory.cycle.completed",{status:"needs_review",reason:"No deterministic successful tool evidence was recorded within the iteration budget; human review required."});return {cycleId,status:"needs_review",iterations:results};
  }catch(error){finishFactoryCycle(cycleId,"failed");addCycleEvent(cycleId,"factory.cycle.failed",{error:String(error)});addCycleEvent(cycleId,"factory.conversation.assistant",{message:`Factory cycle failed. ${String(error)}`});return {cycleId,status:"failed",iterations:results,error:String(error)};}
}

/** Continue an existing cycle as a conversation without rebuilding its original plan. */
export async function continueFactoryCycle(request:FactoryFollowUpRequest){
  const normalized=FactoryFollowUpRequest.parse(request);const cycle=getFactoryCycle(normalized.cycleId) as {id:string;project_id:string;objective:string;constraints_json:string;status:string}|undefined;if(!cycle)throw new Error("cycle not found");
  const constraints=parseConstraints(cycle.constraints_json);const history=conversationContext(cycle.id);const prompt=`Continue the existing Factory Cycle conversation. The original objective is:\n${cycle.objective}\nConstraints:\n${constraints.join("\n")||"None specified"}\n\nConversation so far:\n${history||"No prior conversation."}\n\nThe user's latest follow-up is:\n${normalized.message}\n\nAnswer the follow-up directly and, when an engineering action is requested, inspect the current state and make only verified, necessary changes. Do not manufacture or dispatch anything.`;
  addCycleEvent(cycle.id,"factory.conversation.user",{message:normalized.message});
  const result=await runAgent(cycle.project_id,prompt,cycle.id);
  addCycleEvent(cycle.id,"factory.conversation.assistant",{message:result.output??""});
  addCycleEvent(cycle.id,"factory.followup.completed",{runId:result.runId,status:result.output?"completed":"empty"});
  return {cycleId:cycle.id,status:result.output?"completed":"needs_review",run:result};
}
