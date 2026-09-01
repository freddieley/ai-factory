import OpenAI from "openai";
import { config } from "./config.js";
import { addEvent, finishRun, createRun } from "./db.js";
import { fusion } from "./fusion.js";
import { ExecutionController } from "./execution.js";
import { requestModel } from "./model.js";
import { executeCreateBox, executeCreateCylinder, executeCreateMountingPlate, executeCreateEnclosure } from "./cad.js";
import { executeCreatePlate } from "./plate.js";
import { getClient, providerInfo } from "./providers.js";
import { createEngineeringPlan } from "./planner.js";
import { savePlan } from "./engineering-db.js";

const SYSTEM = `You are AI Factory, a fast, disciplined autonomous engineering agent for civilian robotics, CAD, software, and physical product R&D.
Treat the engineering plan as the source of truth. Inspect before modifying. Prefer deterministic ai_factory_* tools over raw Fusion Python. Never claim success without tool evidence. Diagnose exact tool errors before retrying and never repeat an identical failed call. Preserve requested dimensions and reject impossible geometry rather than silently changing it. Physical manufacturing or irreversible machine execution always requires explicit human approval. Stop when sufficient evidence exists.`;
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

const LOCAL_CAD_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "ai_factory_create_box", description: "Create and verify a rectangular solid in a new Fusion design.", parameters: { type: "object", additionalProperties: false, properties: { widthMm: { type: "number" }, depthMm: { type: "number" }, heightMm: { type: "number" } }, required: ["widthMm", "depthMm", "heightMm"] } } },
  { type: "function", function: { name: "ai_factory_create_cylinder", description: "Create and verify a cylindrical solid in a new Fusion design.", parameters: { type: "object", additionalProperties: false, properties: { radiusMm: { type: "number" }, heightMm: { type: "number" } }, required: ["radiusMm", "heightMm"] } } },
  { type: "function", function: { name: "ai_factory_create_plate", description: "Create and verify a rectangular plate with one through-hole in a new Fusion design. Hole center defaults to plate center.", parameters: { type: "object", additionalProperties: false, properties: { widthMm: { type: "number" }, depthMm: { type: "number" }, heightMm: { type: "number" }, holeDiameterMm: { type: "number" }, holeXmm: { type: "number" }, holeYmm: { type: "number" } }, required: ["widthMm", "depthMm", "heightMm", "holeDiameterMm"] } } },
  { type: "function", function: { name: "ai_factory_create_mounting_plate", description: "Create and verify a rectangular mounting plate with four cylindrical corner posts in one new Fusion design.", parameters: { type: "object", additionalProperties: false, properties: { widthMm: { type: "number" }, depthMm: { type: "number" }, plateHeightMm: { type: "number" }, postRadiusMm: { type: "number" }, postHeightMm: { type: "number" }, insetMm: { type: "number" } }, required: ["widthMm", "depthMm", "plateHeightMm", "postRadiusMm", "postHeightMm", "insetMm"] } } },
  { type: "function", function: { name: "ai_factory_create_enclosure", description: "Create and verify an open-top rectangular electronics enclosure/tray with one base and four surrounding walls.", parameters: { type: "object", additionalProperties: false, properties: { widthMm: { type: "number" }, depthMm: { type: "number" }, baseHeightMm: { type: "number" }, wallHeightMm: { type: "number" }, wallThicknessMm: { type: "number" } }, required: ["widthMm", "depthMm", "baseHeightMm", "wallHeightMm", "wallThicknessMm"] } } }
];
function mcpToolsAsOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] { return [...LOCAL_CAD_TOOLS, ...fusion.getTools().map(tool => ({ type: "function" as const, function: { name: `fusion__${tool.name}`, description: tool.description ?? `Autodesk Fusion tool: ${tool.name}`, parameters: tool.inputSchema ?? { type: "object", properties: {} } } }))]; }
function getFunctionToolCalls(toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined): ToolCall[] { return (toolCalls ?? []).filter((call): call is ToolCall => call.type === "function" && "function" in call && typeof call.function?.name === "string"); }
function unwrapMcpResult(result: unknown): string { const text = JSON.stringify(result); return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[truncated]` : text; }

export async function runAgent(projectId: string, prompt: string) {
  const info = providerInfo(); const client = getClient(); const runId = createRun(projectId, prompt, info.provider, info.model);
  const controller = new ExecutionController({ maxModelCalls: config.MAX_MODEL_CALLS, maxToolCalls: config.MAX_TOOL_CALLS, maxWallMs: config.MAX_RUN_MS });
  try {
    try { await Promise.race([fusion.connect(), new Promise((_, reject) => setTimeout(() => reject(new Error(`Fusion connection timed out after ${config.TOOL_TIMEOUT_MS}ms`)), config.TOOL_TIMEOUT_MS))]); await Promise.race([fusion.refresh(), new Promise((_, reject) => setTimeout(() => reject(new Error(`Fusion discovery timed out after ${config.TOOL_TIMEOUT_MS}ms`)), config.TOOL_TIMEOUT_MS))]); addEvent(runId, "fusion.connected", { tools: fusion.getTools().map(tool => tool.name) }); } catch (error) { addEvent(runId, "fusion.unavailable", { error: String(error) }); }

    if (!controller.canModelCall()) throw new Error("Execution budget exhausted before planning.");
    controller.recordModelCall();
    const planStarted = Date.now(); addEvent(runId, "model.start", { step: 0, call: controller.modelCalls, purpose: "engineering_plan" });
    let plan;
    try { plan = await createEngineeringPlan(projectId, prompt, runId); addEvent(runId, "model.message", { step: 0, purpose: "engineering_plan", elapsedMs: Date.now() - planStarted, toolCalls: [], budget: controller.summary() }); }
    catch (error) { addEvent(runId, "model.error", { step: 0, purpose: "engineering_plan", error: String(error), elapsedMs: Date.now() - planStarted }); throw error; }
    savePlan(projectId, plan);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM }, { role: "user", content: `Project ID: ${projectId}\nEngineering plan:\n${JSON.stringify(plan, null, 2)}\n\nUser request:\n${prompt}` }];
    for (let step = 1; step <= config.MAX_AGENT_STEPS; step++) {
      if (!controller.canModelCall()) break; controller.recordModelCall(); const modelStarted = Date.now(); addEvent(runId, "model.start", { step, call: controller.modelCalls });
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try { response = await requestModel({ client, model: info.model, temperature: config.TEMPERATURE, messages, tools: mcpToolsAsOpenAI(), timeoutMs: config.MODEL_TIMEOUT_MS, retries: config.MODEL_RETRIES, onRetry: (attempt, error) => addEvent(runId, "model.retry", { step, attempt, error: String(error) }) }); }
      catch (error) { addEvent(runId, "model.error", { step, error: String(error), elapsedMs: Date.now() - modelStarted }); throw error; }
      const message = response.choices[0]?.message; if (!message) throw new Error("Model returned no message."); messages.push(message);
      const calls = getFunctionToolCalls(message.tool_calls); addEvent(runId, "model.message", { step, elapsedMs: Date.now() - modelStarted, content: message.content ?? null, toolCalls: calls.map(call => call.function.name), budget: controller.summary() });
      if (calls.length === 0) { const output = message.content ?? ""; finishRun(runId, "completed", output); return { runId, output, plan, provider: info }; }
      for (const call of calls) {
        if (!controller.canToolCall()) break; const rawName = call.function.name; let args: Record<string, unknown>; try { args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>; } catch { args = {}; }
        if (controller.isRepeated(rawName, args)) { const content = JSON.stringify({ error: "Repeated tool call blocked. Use the previous result or change the request." }); addEvent(runId, "tool.repeated", { step, toolName: rawName, args }); messages.push({ role: "tool", tool_call_id: call.id, content }); continue; }
        controller.recordToolCall(); const toolStarted = Date.now(); addEvent(runId, "tool.call", { step, toolName: rawName, args, call: controller.toolCalls });
        try {
          let result: unknown;
          if (rawName === "ai_factory_create_box") result = await executeCreateBox(args);
          else if (rawName === "ai_factory_create_cylinder") result = await executeCreateCylinder(args);
          else if (rawName === "ai_factory_create_plate") result = await executeCreatePlate(args);
          else if (rawName === "ai_factory_create_mounting_plate") result = await executeCreateMountingPlate(args);
          else if (rawName === "ai_factory_create_enclosure") result = await executeCreateEnclosure(args);
          else if (!rawName.startsWith("fusion__")) result = { error: "Unknown tool namespace." };
          else { const toolName = rawName.slice("fusion__".length); result = await Promise.race([fusion.callTool(toolName, args), new Promise((_, reject) => setTimeout(() => reject(new Error(`Fusion tool ${toolName} timed out after ${config.TOOL_TIMEOUT_MS}ms`)), config.TOOL_TIMEOUT_MS))]); }
          const content = unwrapMcpResult(result); addEvent(runId, "tool.result", { step, toolName: rawName, elapsedMs: Date.now() - toolStarted, result }); messages.push({ role: "tool", tool_call_id: call.id, content });
        } catch (error) { const content = JSON.stringify({ error: String(error), toolName: rawName }); addEvent(runId, "tool.error", { step, toolName: rawName, elapsedMs: Date.now() - toolStarted, error: String(error) }); messages.push({ role: "tool", tool_call_id: call.id, content }); }
      }
    }
    const output = `Run stopped safely at the execution budget. Model calls: ${controller.modelCalls}; tool calls: ${controller.toolCalls}; elapsed: ${controller.elapsedMs}ms. Review run events before retrying.`; addEvent(runId, "run.budget_exhausted", controller.summary()); finishRun(runId, "budget_exhausted", output); return { runId, output, plan, provider: info };
  } catch (error) { const output = `Agent failed: ${String(error)}`; finishRun(runId, "failed", output); return { runId, output, provider: info }; }
}
