export type FactoryStreamEvent={id:string;type:string;payload:string;created_at:string};

function payloadOf(event:FactoryStreamEvent):Record<string,unknown>{try{return JSON.parse(event.payload) as Record<string,unknown>;}catch{return {};}}

function toolMessage(toolName:string):string{
  if(toolName==="ai_factory_inspect_fusion") return `Inspecting the current Fusion document (${toolName}).`;
  if(toolName.startsWith("ai_factory_create_")) return `Creating ${toolName.replace("ai_factory_create_","").replaceAll("_"," ")} (${toolName}).`;
  if(toolName.startsWith("ai_factory_")) return `Running ${toolName.replace("ai_factory_","").replaceAll("_"," ")} (${toolName}).`;
  return `Running factory tool ${toolName}.`;
}

export function messageForCycleEvent(event:FactoryStreamEvent):string|null{
  const payload=payloadOf(event);
  switch(event.type){
    case "factory.cycle.started": return "Factory cycle started.";
    case "factory.planning.started": return "Turning the request into a validated engineering plan.";
    case "factory.planning.completed": return `Engineering plan ready — ${String(payload.steps??0)} step${payload.steps===1?"":"s"} identified.`;
    case "factory.planning.failed": return `I couldn’t complete the engineering plan. ${String(payload.error??"Please review the cycle details.")}`;
    case "factory.iteration.started": return `Working through engineering iteration ${String(payload.iteration??"")}…`;
    case "model.start": return `Processing engineering step ${String(payload.step??"")}…`;
    case "model.message": return typeof payload.content==="string"&&payload.content.trim()?payload.content:null;
    case "tool.call": return toolMessage(String(payload.toolName??"a factory tool"));
    case "tool.result": return `Completed ${String(payload.toolName??"factory operation")}.`;
    case "tool.error": return `A factory tool reported an error: ${String(payload.error??"unknown error")}`;
    case "factory.iteration.completed": return "Engineering iteration completed; checking the verified result.";
    case "factory.verification.completed": return "Deterministic verification completed.";
    case "factory.cycle.completed": return payload.status==="completed"?"Factory cycle completed successfully.":`Factory cycle finished with status: ${String(payload.status??"needs_review")}.`;
    case "factory.cycle.failed": return `Factory cycle failed. ${String(payload.error??"")}`;
    case "run.budget_exhausted": return "The execution budget was reached safely. Review the run before retrying.";
    case "factory.followup.completed": return "Follow-up completed.";
    case "factory.conversation.assistant": return typeof payload.message==="string"?payload.message:null;
    case "factory.conversation.response": return typeof payload.message==="string"?payload.message:null;
    default: return null;
  }
}

export function sse(event:string,data:unknown):string{
  const serialized=JSON.stringify(data).replace(/\r?\n/g,"\\n");
  return `event: ${event}\ndata: ${serialized}\n\n`;
}
