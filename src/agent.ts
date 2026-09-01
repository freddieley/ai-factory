import OpenAI from "openai";
import { config } from "./config.js";
import { addEvent, finishRun, createRun } from "./db.js";
import { fusion } from "./fusion.js";
import { getClient, providerInfo } from "./providers.js";
import { ExecutionController, withTimeout } from "./execution.js";

const SYSTEM = `
You are AI Factory, a fast, disciplined engineering agent for civilian robotics and CAD work.

Your job is to help users design, analyze, document, and prepare benign engineering projects.

Execution rules:
- Prefer the smallest number of tool calls that can establish the requested result.
- For a request to create a new Fusion design, do NOT search recent documents first. Create the document directly with the Fusion API.
- For simple deterministic geometry, prefer ONE fusion_mcp_execute script followed by ONE read/verification call.
- Never claim a Fusion operation succeeded unless its result confirms it.
- If a Fusion tool returns an error, diagnose that exact error before retrying. Do not repeat or guess with unrelated API methods.
- Do not retry an identical tool call after it has failed unless the arguments or diagnosis changed.
- If the requested outcome is already satisfied, stop and report it.
- Never dispatch physical machinery or irreversible manufacturing jobs without explicit human approval.
- For fabrication, produce a proposal/approval request rather than silently starting a machine.
- When you have enough evidence, answer the user directly. Do not call another tool merely to make the report prettier.

Fusion Python API facts:
- Get the application with adsk.core.Application.get().
- Create a new Fusion design with app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType).
- Get the active design with adsk.fusion.Design.cast(app.activeProduct).
- Get the root component with design.rootComponent.
- Add a sketch with rootComp.sketches.add(rootComp.xYConstructionPlane) or another construction plane.
- Create a rectangle with sketch.sketchCurves.sketchLines.addTwoPointRectangle(Point3D.create(x1,y1,0), Point3D.create(x2,y2,0)).
- Get the profile with sketch.profiles.item(0).
- Create an extrusion with rootComp.features.extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation), then extInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(distance)), then extrudes.add(extInput).
- Do NOT use adsk.fusion.Design.get(), adsk.fusion.Design.create(), createSketchOn(), or createExtrude(); those are not valid for this desktop Fusion API workflow.
- Fusion API lengths used by ValueInput.createByReal are centimeters in the standard API examples. When a user specifies millimetres, convert mm to cm before createByReal. For example 50 mm = 5.0 and 5 mm = 0.5.
- For verification, use the resulting BRep body's boundingBox and convert its xLength/yLength/zLength from cm to mm.

For the 50 x 50 x 5 mm benchmark specifically, use a single new document, one XY-plane sketch, one rectangle from (0,0) to (5,5), and one 0.5 cm extrusion. Return compact diagnostic output from the script.

Performance target: finish routine CAD tasks in seconds, not minutes. Keep responses and tool arguments compact.
`;

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function mcpToolsAsOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return fusion.getTools().map((tool) => ({
    type: "function",
    function: {
      name: `fusion__${tool.name}`,
      description: tool.description ?? `Autodesk Fusion tool: ${tool.name}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  }));
}

function getFunctionToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
): ToolCall[] {
  if (!toolCalls) return [];
  return toolCalls.filter(
    (call): call is ToolCall =>
      call.type === "function" &&
      "function" in call &&
      typeof call.function?.name === "string"
  );
}

function unwrapMcpResult(result: unknown): string {
  const text = JSON.stringify(result);
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[truncated]` : text;
}

export async function runAgent(projectId: string, prompt: string) {
  const info = providerInfo();
  const client = getClient();
  const runId = createRun(projectId, prompt, info.provider, info.model);
  const controller = new ExecutionController({
    maxModelCalls: config.MAX_MODEL_CALLS,
    maxToolCalls: config.MAX_TOOL_CALLS,
    maxWallMs: config.MAX_RUN_MS
  });

  try {
    try {
      await withTimeout(fusion.connect(), config.TOOL_TIMEOUT_MS, "Fusion connection");
      await withTimeout(fusion.refresh(), config.TOOL_TIMEOUT_MS, "Fusion tool discovery");
      addEvent(runId, "fusion.connected", { tools: fusion.getTools().map((tool) => tool.name) });
    } catch (error) {
      addEvent(runId, "fusion.unavailable", { error: String(error) });
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Project ID: ${projectId}\n\nUser request:\n${prompt}` }
    ];

    for (let step = 1; step <= config.MAX_AGENT_STEPS; step++) {
      if (!controller.canModelCall()) break;
      controller.recordModelCall();
      const modelStarted = Date.now();
      addEvent(runId, "model.start", { step, call: controller.modelCalls });

      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await withTimeout(
          client.chat.completions.create({
            model: info.model,
            temperature: config.TEMPERATURE,
            messages,
            tools: mcpToolsAsOpenAI(),
            tool_choice: "auto"
          }),
          config.MODEL_TIMEOUT_MS,
          "Model request"
        );
      } catch (error) {
        addEvent(runId, "model.error", { step, error: String(error), elapsedMs: Date.now() - modelStarted });
        throw error;
      }

      const message = response.choices[0]?.message;
      if (!message) throw new Error("Model returned no message.");
      messages.push(message);

      const functionToolCalls = getFunctionToolCalls(message.tool_calls);
      addEvent(runId, "model.message", {
        step,
        elapsedMs: Date.now() - modelStarted,
        content: message.content ?? null,
        toolCalls: functionToolCalls.map((call) => call.function.name),
        budget: controller.summary()
      });

      if (functionToolCalls.length === 0) {
        const output = message.content ?? "";
        finishRun(runId, "completed", output);
        return { runId, output, provider: info };
      }

      for (const call of functionToolCalls) {
        if (!controller.canToolCall()) break;
        const rawName = call.function.name;
        if (!rawName.startsWith("fusion__")) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Unknown tool namespace." }) });
          continue;
        }

        const toolName = rawName.slice("fusion__".length);
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }

        if (controller.isRepeated(toolName, args)) {
          const content = JSON.stringify({ error: "Repeated tool call blocked. Use the previous result or change the request." });
          addEvent(runId, "tool.repeated", { step, toolName, args });
          messages.push({ role: "tool", tool_call_id: call.id, content });
          continue;
        }

        controller.recordToolCall();
        const toolStarted = Date.now();
        addEvent(runId, "tool.call", { step, toolName, args, call: controller.toolCalls });

        try {
          const result = await withTimeout(
            fusion.callTool(toolName, args),
            config.TOOL_TIMEOUT_MS,
            `Fusion tool ${toolName}`
          );
          const content = unwrapMcpResult(result);
          addEvent(runId, "tool.result", { step, toolName, elapsedMs: Date.now() - toolStarted, result });
          messages.push({ role: "tool", tool_call_id: call.id, content });
        } catch (error) {
          const content = JSON.stringify({ error: String(error), toolName });
          addEvent(runId, "tool.error", { step, toolName, elapsedMs: Date.now() - toolStarted, error: String(error) });
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
