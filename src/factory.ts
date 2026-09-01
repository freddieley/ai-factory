import { z } from "zod";
import { randomUUID } from "node:crypto";
import { runAgent } from "./agent.js";
import { addEvent, listEvents } from "./db.js";

export const FactoryRequest = z.object({ projectId:z.string().min(1), objective:z.string().min(1), constraints:z.array(z.string()).default([]), maxIterations:z.number().int().min(1).max(5).default(2) });
export type FactoryRequest = z.infer<typeof FactoryRequest>;

type EventRow = { type: string; payload: string };

function hasVerifiedToolResult(events: EventRow[]): boolean {
  return events.some((event) => {
    if (event.type !== "tool.result") return false;
    try {
      const payload = JSON.parse(event.payload) as { result?: { success?: boolean } };
      return payload.result?.success === true;
    } catch {
      return false;
    }
  });
}

function hasUnresolvedCondition(output: string): boolean {
  return /not verified|unable to|failed|error|unmet|cannot|blocked|needs review/i.test(output);
}

/**
 * Run a bounded engineering cycle. Completion is evidence-driven: the model's
 * prose is never treated as proof of a successful physical/CAD operation.
 * Deterministic tool results recorded in the run event stream are the source
 * of truth for successful execution.
 */
export async function runFactory(request:FactoryRequest){
  const normalized=FactoryRequest.parse(request); const cycleId=randomUUID(); const results:unknown[]=[];
  addEvent(cycleId,"factory.cycle.started",{objective:normalized.objective,constraints:normalized.constraints,maxIterations:normalized.maxIterations});
  for(let iteration=1;iteration<=normalized.maxIterations;iteration++){
    const prompt=iteration===1
      ? `Act as the CAD engineering executor. Build the requested design in Fusion if appropriate. Objective: ${normalized.objective}\nConstraints:\n${normalized.constraints.join("\n")||"None specified"}\nFirst inspect the current document. Make only the CAD changes needed for the objective. After each modification inspect the resulting state. Do not manufacture or dispatch anything.`
      : `Iteration ${iteration} of a bounded CAD engineering loop. Re-open the current Fusion state, inspect the existing design against this objective, identify unmet requirements, make only necessary CAD corrections, and verify the resulting state with Fusion evidence. Objective: ${normalized.objective}\nConstraints:\n${normalized.constraints.join("\n")||"None specified"}\nDo not manufacture or dispatch anything.`;
    addEvent(cycleId,"factory.iteration.started",{iteration});
    const result=await runAgent(normalized.projectId,prompt);
    const events=listEvents(result.runId) as EventRow[];
    const verified=hasVerifiedToolResult(events);
    const unresolved=hasUnresolvedCondition(result.output ?? "");
    results.push({iteration,result,verification:{verified,unresolved}});
    addEvent(cycleId,"factory.iteration.completed",{iteration,runId:result.runId,verified,unresolved,output:result.output});

    if(verified && !unresolved){
      addEvent(cycleId,"factory.verification.completed",{iteration,runId:result.runId,source:"deterministic tool result"});
      addEvent(cycleId,"factory.cycle.completed",{iteration,reason:"Deterministic tool evidence confirmed a successful operation."});
      return {cycleId,status:"completed",iterations:results};
    }
  }
  addEvent(cycleId,"factory.cycle.completed",{reason:"No deterministic successful tool evidence was recorded within the iteration budget; human review required."});
  return {cycleId,status:"needs_review",iterations:results};
}
