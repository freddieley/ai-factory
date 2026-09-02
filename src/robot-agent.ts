import OpenAI from "openai";
import { config } from "./config.js";
import { addEvent, finishRun } from "./db.js";
import { fusion } from "./fusion.js";
import { executeCapability } from "./capabilities.js";
import { parseRobotDesignTransport, robotDesignHash } from "./robot-design.js";

const ROBOT_SYSTEM = `You are the mechanical design model for AI Factory. You author the robot design; the deterministic factory validates it and executes it in Fusion.

Return ONLY one complete JSON object matching ai-factory.robot-design/v1. Do not return markdown, prose, a JSON string, or a function/tool call.

Required top-level fields: schema, name, mission, requirements, parts, joints, designRationale, unresolvedQuestions.
Each part requires id, name, material, manufacturingProcess, geometry. Geometry requires schema ai-factory.robot-geometry/v1, units mm, operations, outputOperationId. Each operation requires id, op, inputs, parameters.

Executable CAD operations are: sketch, rectangle, circle, extrude, transform. Rectangle parameters use widthMm, heightMm, centerX, centerY, rotationDeg. Circle uses radiusMm, centerX, centerY. Extrude uses distanceMm for thickness. Use transform to place/rotate a finished body when required. The graph must be connected to outputOperationId and contain no dangling references or cycles.

Design the requested object yourself. Do not use a factory template and do not invent geometry outside the request. Interpret overall dimensions such as a 300 mm frame span as plan-view size, never as extrusion thickness. If a requirement is underspecified, make a conservative engineering assumption and record it in unresolvedQuestions. Keep geometry in millimetres. Fixed assembly joints require two real part IDs; use joints: [] when there is no true two-part assembly relationship.

The design must be mechanically coherent: repeated components should occupy distinct intended positions, thin structural members should have sensible thickness, and mounting features must not be accidentally duplicated or left disconnected.`;

type RobotAgentArgs = {
  projectId: string;
  prompt: string;
  cycleId?: string;
  runId: string;
  client: OpenAI;
  info: { provider: string; model: string };
};

function unwrapResult(result: unknown): string {
  const text = JSON.stringify(result);
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n[truncated]` : text;
}

function sameDesign(a: unknown, b: unknown): boolean {
  try {
    return robotDesignHash(a) === robotDesignHash(b);
  } catch {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

export async function runRobotAgent({ projectId, prompt, cycleId, runId, client, info }: RobotAgentArgs) {
  try {
    try {
      await fusion.connect();
      await fusion.refresh();
      if (!fusion.isConnected()) throw new Error("Fusion MCP did not report a connected state.");
      addEvent(runId, "fusion.connected", { tools: fusion.getTools().map(tool => tool.name), mode: "robot-json-design" });
    } catch (error) {
      addEvent(runId, "fusion.unavailable", { error: String(error), mode: "robot-json-design" });
      throw error;
    }

    let previousDesign: unknown = null;
    let previousError = "";
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: ROBOT_SYSTEM },
      { role: "user", content: `Project ID: ${projectId}\n\nBuild request:\n${prompt}` },
    ];

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) {
        messages.push({ role: "user", content: `The deterministic factory rejected the previous design with this exact evidence:\n${previousError}\n\nCreate a materially corrected design. Do not repeat the previous design. Return ONLY the complete JSON object.` });
      }

      const modelStarted = Date.now();
      addEvent(runId, "model.start", { step: attempt, call: attempt, mode: "robot-json-design" });
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await client.chat.completions.create({
          model: info.model,
          temperature: config.TEMPERATURE,
          max_tokens: 5000,
          messages,
        });
      } catch (error) {
        addEvent(runId, "model.error", { step: attempt, error: String(error), elapsedMs: Date.now() - modelStarted, mode: "robot-json-design" });
        throw error;
      }

      const message = response.choices[0]?.message;
      const content = message?.content?.trim() ?? "";
      addEvent(runId, "model.message", { step: attempt, elapsedMs: Date.now() - modelStarted, content: content || null, toolCalls: [], mode: "robot-json-design" });
      if (!content) {
        previousError = "Model returned an empty design response.";
        continue;
      }

      let design: unknown;
      try {
        design = parseRobotDesignTransport(content);
      } catch (error) {
        previousError = String(error);
        addEvent(runId, "tool.error", { step: attempt, toolName: "ai_factory_submit_robot_design", error: previousError, phase: "transport" });
        continue;
      }

      if (previousDesign !== null && sameDesign(previousDesign, design)) {
        previousError = "The model returned an identical robot design after deterministic rejection. A materially different design is required.";
        addEvent(runId, "tool.repeated", { step: attempt, toolName: "ai_factory_submit_robot_design", reason: previousError });
        continue;
      }
      previousDesign = design;

      addEvent(runId, "tool.call", { step: attempt, toolName: "ai_factory_submit_robot_design", args: { design }, call: attempt, mode: "robot-json-design" });
      const toolStarted = Date.now();
      try {
        const result = await executeCapability("ai_factory_submit_robot_design", { design });
        addEvent(runId, "tool.result", { step: attempt, toolName: "ai_factory_submit_robot_design", elapsedMs: Date.now() - toolStarted, result });
        const cad = typeof result === "object" && result !== null && "cad" in result ? (result as { cad?: { success?: boolean } }).cad : null;
        if (cad?.success === true) {
          const output = "Robot design compiled and verified in Fusion.";
          addEvent(runId, "factory.robot_cad.verified", { designHash: (result as { designHash?: unknown }).designHash, cad, mode: "robot-json-design" });
          finishRun(runId, "completed", output);
          return { runId, output, provider: info };
        }
        previousError = `Robot CAD compiler returned without verified success: ${unwrapResult(result)}`;
      } catch (error) {
        previousError = String(error);
        addEvent(runId, "tool.error", { step: attempt, toolName: "ai_factory_submit_robot_design", elapsedMs: Date.now() - toolStarted, error: previousError, mode: "robot-json-design" });
      }
    }

    const failure = `Robot CAD submission failed after 2 model-authored attempts. Last deterministic evidence: ${previousError}`;
    finishRun(runId, "failed", "");
    return { runId, output: "", error: failure, provider: info };
  } catch (error) {
    const message = String(error);
    addEvent(runId, "run.failed", { error: message, mode: "robot-json-design" });
    finishRun(runId, "failed", "");
    return { runId, output: "", error: message, provider: info };
  }
}
