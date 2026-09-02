import { config } from "./config.js";
import { addEvent, finishRun } from "./db.js";
import { fusion } from "./fusion.js";
import { executeCapability } from "./capabilities.js";
import { parseRobotDesignTransport, robotDesignHash } from "./robot-design.js";
import { withAbortTimeout, withTimeout } from "./execution.js";

type RobotAgentArgs = {
  projectId: string;
  prompt: string;
  cycleId?: string;
  runId: string;
  client: any;
  info: { provider: string; model: string };
};

const ROBOT_SYSTEM = `You are the mechanical design model for AI Factory. You author the robot design; the deterministic factory validates it and executes it in Fusion.

Return ONLY one complete JSON object matching ai-factory.robot-design/v1. Never return markdown, prose, a JSON string, or a tool call.

Top-level fields MUST be: schema, name, mission, requirements, parts, joints, designRationale, unresolvedQuestions.
Each part MUST contain id, name, material, manufacturingProcess, geometry. Geometry MUST contain schema ai-factory.robot-geometry/v1, units: "mm", operations, outputOperationId. Every operation MUST contain id, op, inputs, parameters.

SUPPORTED EXECUTABLE OPS ARE ONLY: sketch, rectangle, circle, extrude, transform.
For every operation, inputs is ALWAYS an array of STRING operation IDs, never objects. Do not write {"id":"..."} inside inputs.
Parameters are JSON values, but executable geometry uses these exact fields: rectangle = widthMm, heightMm, centerX, centerY, rotationDeg; circle = radiusMm, centerX, centerY; extrude = distanceMm; transform = rotationDeg/rotateDeg plus translateXmm/translateYmm or translateX/translateY.
A sketch normally has parameters {"plane":"XY"} or {}. Do NOT put an array of geometry operations inside sketch.parameters unless you are deliberately using the supported nested-sketch compatibility form.
Every part MUST set outputOperationId to the final operation ID. No missing, dangling, or cyclic references.

designRationale MUST be an ARRAY OF STRINGS. unresolvedQuestions MUST be an ARRAY OF STRINGS. A joint, when present, MUST use {id,parentPartId,childPartId,type} where type is fixed, revolute, prismatic, spherical, or planar. Do not use partIds, part1Id, part2Id, or jointType. Use joints: [] unless a real two-part assembly relationship is required.

Design the requested object yourself. Do not use a factory template. Interpret overall dimensions such as a 300 mm frame span as plan-view dimensions, never as extrusion thickness. Make conservative engineering assumptions when the request is underspecified and record them in unresolvedQuestions. Keep structural thickness physically sensible. Repeated components must be placed at distinct intended positions using transform or explicit rectangle/circle centers. The final graph must represent the requested geometry, not merely placeholders.`;

function compactEvidence(value: unknown, maxLength = 4_000): string {
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n[truncated]` : text;
}

function sameDesign(a: unknown, b: unknown): boolean {
  try {
    return robotDesignHash(a) === robotDesignHash(b);
  } catch {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

function buildRetryPrompt(originalPrompt: string, error: string, attempt: number): string {
  return `Build request:\n${originalPrompt}\n\nThis is correction attempt ${attempt}. The deterministic factory rejected the prior submission. Fix the evidence below instead of repeating the prior structure.\n\nREJECTION EVIDENCE:\n${error}\n\nHard contract reminders:\n- Return exactly one complete JSON object.\n- inputs contains strings only.\n- designRationale and unresolvedQuestions are arrays of strings.\n- joints use parentPartId, childPartId, and type; otherwise use joints: [].\n- Do not nest arbitrary operation arrays inside parameters.\n- outputOperationId must exist for every part.\n- Keep geometry physically sensible and place repeated parts distinctly.\n\nReturn ONLY the corrected JSON object.`;
}

async function requestRobotModel(client: any, model: string, temperature: number, messages: any[], signal: AbortSignal): Promise<any> {
  try {
    return await client.chat.completions.create({
      model,
      temperature,
      max_tokens: 7000,
      messages,
      response_format: { type: "json_object" },
    }, { signal });
  } catch (error) {
    const message = String(error);
    if (!/response.?format|json_object|unsupported|not supported/i.test(message)) throw error;
    return await client.chat.completions.create({
      model,
      temperature,
      max_tokens: 7000,
      messages,
    }, { signal });
  }
}

export async function runRobotAgent({ projectId, prompt, cycleId, runId, client, info }: RobotAgentArgs) {
  try {
    await withTimeout(fusion.connect(), config.TOOL_TIMEOUT_MS, "Fusion connection");
    await withTimeout(fusion.refresh(), config.TOOL_TIMEOUT_MS, "Fusion tool discovery");
    if (!fusion.isConnected()) throw new Error("Fusion MCP did not report a connected state.");
    addEvent(runId, "fusion.connected", { tools: fusion.getTools().map(tool => tool.name), mode: "robot-json-design" });

    let previousDesign: unknown = null;
    let previousError = "";

    for (let attempt = 1; attempt <= 3; attempt++) {
      const modelMessages = attempt === 1
        ? [
            { role: "system", content: ROBOT_SYSTEM },
            { role: "user", content: `Project ID: ${projectId}\n\nBuild request:\n${prompt}` },
          ]
        : [
            { role: "system", content: ROBOT_SYSTEM },
            { role: "user", content: buildRetryPrompt(prompt, previousError, attempt) },
          ];

      const modelStarted = Date.now();
      addEvent(runId, "model.start", { step: attempt, call: attempt, mode: "robot-json-design", provider: info.provider, model: info.model });
      let response: any;
      try {
        const timeoutMs = Math.min(Math.max(config.MODEL_TIMEOUT_MS, 120_000), 180_000);
        response = await withAbortTimeout(
          signal => requestRobotModel(client, info.model, attempt === 1 ? config.TEMPERATURE : 0, modelMessages, signal),
          timeoutMs,
          "Robot design model request",
        );
      } catch (error) {
        addEvent(runId, "model.error", { step: attempt, error: String(error), elapsedMs: Date.now() - modelStarted, mode: "robot-json-design", provider: info.provider, model: info.model });
        throw error;
      }

      const message = response?.choices?.[0]?.message;
      const content = typeof message?.content === "string" ? message.content.trim() : "";
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
        previousError = `Robot CAD compiler returned without verified success: ${compactEvidence(result)}`;
      } catch (error) {
        previousError = String(error);
        addEvent(runId, "tool.error", { step: attempt, toolName: "ai_factory_submit_robot_design", elapsedMs: Date.now() - toolStarted, error: previousError, mode: "robot-json-design" });
      }
    }

    const failure = `Robot CAD submission failed after 3 model-authored attempts. Last deterministic evidence: ${previousError}`;
    finishRun(runId, "failed", "");
    return { runId, output: "", error: failure, provider: info };
  } catch (error) {
    const message = String(error);
    addEvent(runId, "fusion.or.robot.failed", { error: message });
    addEvent(runId, "run.failed", { error: message, mode: "robot-json-design" });
    finishRun(runId, "failed", "");
    return { runId, output: "", error: message, provider: info };
  }
}
