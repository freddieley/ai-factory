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
- Prefer deterministic factory capabilities over raw Fusion Python.
- The capability registry is the source of truth for deterministic factory operations; do not duplicate or invent tool definitions.
- Never invent Fusion API code when a deterministic factory capability can satisfy the request.
- Before executing geometry, reason about basic dimensional feasibility. Impossible geometry must be rejected before CAD execution.
- Preserve user-specified dimensions and intent. Never silently change requested dimensions to make an impossible part fit.
- Use structured tool errors as engineering evidence and explain them clearly.
- Never claim success unless a tool result confirms it.
- If a Fusion tool returns an error, diagnose that exact error before retrying. Do not repeat an identical failed call.
- If the requested outcome is already satisfied, stop.
- Never dispatch physical machinery or irreversible manufacturing jobs without explicit human approval. Fabrication should produce a proposal/approval request until the factory's safety and verification layer explicitly authorizes execution.
- Keep routine tasks fast and tool arguments compact.

Deterministic factory capabilities currently available:
- ai_factory_create_box: rectangular solid with widthMm, depthMm, heightMm.
- ai_factory_create_cylinder: cylindrical solid with radiusMm and heightMm.
- ai_factory_create_plate: rectangular plate with one verified through-hole. Parameters: widthMm, depthMm, heightMm, holeDiameterMm, optional holeXmm/holeYmm. Defaults hole center to plate center.
- ai_factory_create_mounting_plate: rectangular base plate plus four cylindrical mounting posts in one new Fusion design.
- ai_factory_create_enclosure: open-top rectangular electronics enclosure/tray with one base and four surrounding walls.
- All deterministic CAD capabilities create and verify their result and report measured dimensions.
- Use create_plate for plates with a through-hole. Do not write Fusion Python for this use case.
- Use create_box for simple cuboids and solid plates without holes.
- Use create_cylinder for shafts, pins, posts, spacers, and simple cylindrical solids.
- Use create_mounting_plate for useful electronics/robotics mounting bases. Do not decompose it into separate calls.
- Use create_enclosure for open-top rectangular electronics enclosures. Do not decompose it into separate calls.

Fusion Python fallback:
- Raw Fusion Python is a last-resort capability, not the default strategy.
- Only use it when no deterministic factory capability can satisfy the requested operation.
- Establish the active Fusion Design before creating geometry: app = adsk.core.Application.get(); product = app.activeProduct; design = adsk.fusion.Design.cast(product); root = design.rootComponent.
- Fusion API ValueInput real lengths are centimetres in this workflow; convert millimetres to centimetres.
- Do not guess at APIs after an error. Inspect the exact error/context first.

Autonomy roadmap:
- Current focus: deterministic hardware/CAD factory.
- Future layers will add engineering planning, requirements traceability, simulation, autonomous testing, software generation for robots, hardware/software co-design, experiment management, and iterative R&D.
- When those capabilities become available, compose them as verified stages rather than asking the model to improvise implementation details.
`;

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

function mcpToolsAsOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    ...toOpenAITools(),
    ...fusion.getTools().map((tool) => ({
      type: "function" as const,
      function: {
        name: `fusion__${tool.name}`,
        description: tool.description ?? `Autodesk Fusion tool: ${tool.name}`,
        parameters: tool.inputSchema ?? { type: "object", properties: {} }
      }
    }))
  ];
}

function getFunctionToolCalls(toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined): ToolCall[] {
  if (!toolCalls) return [];
  return toolCalls.filter((call): call is ToolCall => call.type === "function" && "function" in call && typeof call.function?.name === "string");
}

function unwrapMcpResult(result: unknown): string {
  const text = JSON.stringify(result);
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[truncated]` : text;
}

export async function runAgent(projectId: string, prompt: string) {
  const info = providerInfo();
  const client = getClient();
  const runId = createRun(projectId, prompt, info.provider, info.model);
  const controller = new ExecutionController({ maxModelCalls: config.MAX_MODEL_CALLS, maxToolCalls: config.MAX_TOOL_CALLS, maxWallMs: config.MAX_RUN_MS });

  try {
    try {
      await withTimeout(fusion.connect(), config.TOOL_TIMEOUT_MS, "Fusion connection");
      await withTimeout(fusion.refresh(), config.TOOL_TIMEOUT_MS, "Fusion tool discovery");
      addEvent(runId, "fusion.connected", { tools: fusion.getTools().map((tool) => tool.name) });
    } catch (error) {
      addEvent(runId, "fusion.unavailable", { error: String(error) });
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM }, { role: "user", content: `Project ID: ${projectId}\n\nUser request:\n${prompt}` }];

    for (let step = 1; step <= config.MAX_AGENT_STEPS; step++) {
      if (!controller.canModelCall()) break;
      controller.recordModelCall();
      const modelStarted = Date.now();
      addEvent(runId, "model.start", { step, call: controller.modelCalls });

      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await withTimeout(client.chat.completions.create({ model: info.model, temperature: config.TEMPERATURE, messages, tools: mcpToolsAsOpenAI(), tool_choice: "auto" }), config.MODEL_TIMEOUT_MS, "Model request");
      } catch (error) {
        addEvent(runId, "model.error", { step, error: String(error), elapsedMs: Date.now() - modelStarted });
        throw error;
      }

      const message = response.choices[0]?.message;
      if (!message) throw new Error("Model returned no message.");
      messages.push(message);
      const functionToolCalls = getFunctionToolCalls(message.tool_calls);
      addEvent(runId, "model.message", { step, elapsedMs: Date.now() - modelStarted, content: message.content ?? null, toolCalls: functionToolCalls.map((call) => call.function.name), budget: controller.summary() });
      if (functionToolCalls.length === 0) {
        const output = message.content ?? "";
        finishRun(runId, "completed", output);
        return { runId, output, provider: info };
      }

      for (const call of functionToolCalls) {
        if (!controller.canToolCall()) break;
        const rawName = call.function.name;
        let args: Record<string, unknown>;
        try { args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>; } catch { args = {}; }

        if (controller.isRepeated(rawName, args)) {
          const content = JSON.stringify({ error: "Repeated tool call blocked. Use the previous result or change the request." });
          addEvent(runId, "tool.repeated", { step, toolName: rawName, args });
          messages.push({ role: "tool", tool_call_id: call.id, content });
          continue;
        }

        controller.recordToolCall();
        const toolStarted = Date.now();
        addEvent(runId, "tool.call", { step, toolName: rawName, args, call: controller.toolCalls });
        try {
          let result: unknown;
          if (rawName.startsWith("ai_factory_")) {
            result = await executeCapability(rawName, args);
          } else if (rawName.startsWith("fusion__")) {
            const toolName = rawName.slice("fusion__".length);
            result = await withTimeout(fusion.callTool(toolName, args), config.TOOL_TIMEOUT_MS, `Fusion tool ${toolName}`);
          } else {
            result = { error: "Unknown tool namespace." };
          }
          const content = unwrapMcpResult(result);
          addEvent(runId, "tool.result", { step, toolName: rawName, elapsedMs: Date.now() - toolStarted, result });
          messages.push({ role: "tool", tool_call_id: call.id, content });
        } catch (error) {
          const content = JSON.stringify({ error: String(error), toolName: rawName });
          addEvent(runId, "tool.error", { step, toolName: rawName, elapsedMs: Date.now() - toolStarted, error: String(error) });
          messages.push({ role: "tool", tool_call_id: call.id, content });
        }
      }
    }

    const summary = controller.summary();
    const output = `Run stopped safely at the execution budget. Model calls: ${summary.modelCalls}; tool calls: ${summary.toolCalls}; elapsed: ${summary.elapsedMs}ms. Review run events before retrying.`;
    addEvent(runId, "run.budget_exhausted", summary);
    finishRun(runId, "budget_exhausted", output);
    return { runId, output, provider: info };
  } catch (error) {
    const output = `Agent failed: ${String(error)}`;
    finishRun(runId, "failed", output);
    return { runId, output, provider: info };
  }
}
