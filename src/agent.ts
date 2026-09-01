import OpenAI from "openai";
import { config } from "./config.js";
import { addEvent, finishRun, createRun } from "./db.js";
import { fusion } from "./fusion.js";
import { getClient, providerInfo } from "./providers.js";
import { ExecutionController, withTimeout } from "./execution.js";
import { executeCapability, toOpenAITools } from "./capabilities.js";

const SYSTEM = `
You are AI Factory, a fast, disciplined autonomous engineering agent for civilian robotics, CAD, software, and physical product R&D.

Your job is to turn a user's plain-language project description into an executable engineering plan and, when supported by deterministic factory capabilities, produce verified CAD artifacts.

Core architecture rules:
- Treat the model as planner/orchestrator, not as the CAD kernel.
- The deterministic factory capability registry is the ONLY tool surface available to you. Do not invent, call, or refer to raw Fusion MCP tools.
- Use the smallest number of tool calls necessary to complete the saved engineering plan.
- Use ai_factory_inspect_fusion at most once when existing CAD state is relevant; do not repeatedly inspect the same state.
- Prefer deterministic CAD capabilities for geometry. Never write or invent Fusion Python.
- Before executing geometry, reason about basic dimensional feasibility. Impossible geometry must be rejected before CAD execution.
- Preserve user-specified dimensions and intent. Never silently change requested dimensions to make an impossible part fit.
- Use structured tool errors as engineering evidence and explain them clearly.
- Never claim success unless a tool result confirms it.
- If a factory tool returns an error, diagnose that exact error before retrying. Do not repeat an identical failed call.
- If the requested outcome is already satisfied by verified evidence, stop instead of creating duplicate geometry.
- Never dispatch physical machinery or irreversible manufacturing jobs without explicit human approval.
- Keep routine tasks fast and tool arguments compact.

Deterministic CAD capabilities currently available:
- ai_factory_create_box: rectangular solid with widthMm, depthMm, heightMm.
- ai_factory_create_cylinder: cylindrical solid with radiusMm and heightMm.
- ai_factory_create_plate: rectangular plate with one verified through-hole. Parameters: widthMm, depthMm, heightMm, holeDiameterMm, optional holeXmm/holeYmm.
- ai_factory_create_mounting_plate: rectangular base plate plus four cylindrical mounting posts in one new Fusion design.
- ai_factory_create_enclosure: open-top rectangular electronics enclosure/tray with one base and four surrounding walls.
- All create capabilities create and verify their result and report measured dimensions.
- ai_factory_plan_parametric_box creates a vendor-neutral mechanical definition without executing CAD.
`;

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
function mcpToolsAsOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] { return toOpenAITools(); }
function getFunctionToolCalls(toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]|undefined):ToolCall[]{if(!toolCalls)return [];return toolCalls.filter((call):call is ToolCall=>call.type==="function"&&"function" in call&&typeof call.function?.name==="string");}
function unwrapMcpResult(result:unknown):string{const text=JSON.stringify(result);return text.length>20_000?`${text.slice(0,20_000)}\n[truncated]`:text;}

export async function runAgent(projectId:string,prompt:string,cycleId?:string){
  const info=providerInfo(); const client=getClient(); const runId=createRun(projectId,prompt,info.provider,info.model,cycleId); const controller=new ExecutionController({maxModelCalls:config.MAX_MODEL_CALLS,maxToolCalls:config.MAX_TOOL_CALLS,maxWallMs:config.MAX_RUN_MS});
  try {
    try { await withTimeout(fusion.connect(),config.TOOL_TIMEOUT_MS,"Fusion connection"); await withTimeout(fusion.refresh(),config.TOOL_TIMEOUT_MS,"Fusion tool discovery"); addEvent(runId,"fusion.connected",{tools:fusion.getTools().map(tool=>tool.name)}); }
    catch(error){addEvent(runId,"fusion.unavailable",{error:String(error)});}
    const messages:OpenAI.Chat.Completions.ChatCompletionMessageParam[]=[{role:"system",content:SYSTEM},{role:"user",content:`Project ID: ${projectId}\n\nUser request:\n${prompt}`}];
    for(let step=1;step<=config.MAX_AGENT_STEPS;step++){
      if(!controller.canModelCall())break; controller.recordModelCall(); const modelStarted=Date.now(); addEvent(runId,"model.start",{step,call:controller.modelCalls});
      let response:OpenAI.Chat.Completions.ChatCompletion;
      try { response=await withTimeout(client.chat.completions.create({model:info.model,temperature:config.TEMPERATURE,messages,tools:mcpToolsAsOpenAI(),tool_choice:"auto"}),config.MODEL_TIMEOUT_MS,"Model request"); }
      catch(error){addEvent(runId,"model.error",{step,error:String(error),elapsedMs:Date.now()-modelStarted});throw error;}
      const message=response.choices[0]?.message; if(!message)throw new Error("Model returned no message."); messages.push(message); const functionToolCalls=getFunctionToolCalls(message.tool_calls); addEvent(runId,"model.message",{step,elapsedMs:Date.now()-modelStarted,content:message.content??null,toolCalls:functionToolCalls.map(call=>call.function.name),budget:controller.summary()});
      if(functionToolCalls.length===0){const output=message.content??"";finishRun(runId,"completed",output);return {runId,output,provider:info};}
      for(const call of functionToolCalls){
        if(!controller.canToolCall())break; const rawName=call.function.name; let args:Record<string,unknown>; try{args=JSON.parse(call.function.arguments||"{}") as Record<string,unknown>;}catch{args={};}
        if(controller.isRepeated(rawName,args)){const content=JSON.stringify({error:"Repeated tool call blocked. Use the previous result or change the request."});addEvent(runId,"tool.repeated",{step,toolName:rawName,args});messages.push({role:"tool",tool_call_id:call.id,content});continue;}
        controller.recordToolCall(); const toolStarted=Date.now(); addEvent(runId,"tool.call",{step,toolName:rawName,args,call:controller.toolCalls});
        try { const result=await withTimeout(executeCapability(rawName,args),config.TOOL_TIMEOUT_MS,`Factory capability ${rawName}`); const content=unwrapMcpResult(result);addEvent(runId,"tool.result",{step,toolName:rawName,elapsedMs:Date.now()-toolStarted,result});messages.push({role:"tool",tool_call_id:call.id,content}); }
        catch(error){const content=JSON.stringify({error:String(error),toolName:rawName});addEvent(runId,"tool.error",{step,toolName:rawName,elapsedMs:Date.now()-toolStarted,error:String(error)});messages.push({role:"tool",tool_call_id:call.id,content});}
      }
    }
    const summary=controller.summary();const output=`Run stopped safely at the execution budget. Model calls: ${summary.modelCalls}; tool calls: ${summary.toolCalls}; elapsed: ${summary.elapsedMs}ms. Review run events before retrying.`;addEvent(runId,"run.budget_exhausted",summary);finishRun(runId,"budget_exhausted",output);return {runId,output,provider:info};
  }catch(error){const output=`Agent failed: ${String(error)}`;finishRun(runId,"failed",output);return {runId,output,provider:info};}
}
