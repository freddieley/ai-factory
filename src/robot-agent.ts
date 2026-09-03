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

Use one consistent coordinate system for the whole design. Prefer the primary part's natural center at (0,0) unless the request explicitly defines another origin. Express symmetric features about that origin. Do not mix absolute coordinates with translations that assume a different origin. A placement transform is relative to the geometry's current coordinates, so calculate the resulting world position explicitly.

For a rectangular plate centered at the origin, corner offsets are half the width/height. For features specified by distance from an edge or corner, derive their absolute coordinates from the same plate coordinate system rather than inventing a second coordinate frame.

When a part contains a rectangular outer boundary and circular holes in the same sketch, model the rectangle as the primary solid profile and the circles as internal holes; do not create separate solid cylinders for the holes. When a circular operation is applied to an existing extruded solid, its input must reference that extrusion and it represents a subtraction/through-hole, not a new solid body. Do not try to access sketchCurves on a BRepBody.

For a 100 mm x 60 mm plate centered at (0,0), four 6 mm diameter holes 10 mm from each corner have centers (-40,-20), (40,-20), (-40,20), and (40,20).

For a 20 mm x 20 mm block centered on the left or right edge of that 100 mm plate, use centerX=-40 or +40 and centerY=0 so the block remains on the plate with its outer face aligned to the corresponding side edge. Do not use +/-50 for the block center because a 20 mm wide block would then extend 10 mm beyond the plate.

When repeated parts are needed, each instance must have a genuinely distinct physical placement. Different names alone do not make placements distinct. Avoid coincident duplicate parts.

Do not claim verificationStatus=verified unless the factory has actually verified the result. The final graph must represent the requested geometry, not merely placeholders. Design the requested object yourself rather than selecting a factory template. Interpret overall dimensions as plan-view dimensions, never as extrusion thickness. Make conservative engineering assumptions when the request is underspecified and record them in unresolvedQuestions. Keep structural thickness physically sensible.`;

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

function normalizeRobotDesignModelOutput(value: unknown): unknown {
  const transported = parseRobotDesignTransport(value);
  if (!transported || typeof transported !== "object" || Array.isArray(transported)) return transported;
  const source = transported as Record<string, unknown>;
  if (!Array.isArray(source.parts)) return source;

  const parts = source.parts.map(rawPart => {
    if (!rawPart || typeof rawPart !== "object" || Array.isArray(rawPart)) return rawPart;
    const part = rawPart as Record<string, unknown>;
    const geometry = part.geometry;
    if (Array.isArray(geometry)) {
      const operations = geometry.filter(item => item && typeof item === "object" && !Array.isArray(item));
      const lastOperation = operations[operations.length - 1] as Record<string, unknown> | undefined;
      return {
        ...part,
        geometry: {
          schema: "ai-factory.robot-geometry/v1",
          units: "mm",
          operations,
          outputOperationId: typeof lastOperation?.id === "string" ? lastOperation.id : "",
        },
      };
    }
    return part;
  });

  return { ...source, parts };
}

function buildRetryPrompt(originalPrompt: string, error: string, attempt: number): string {
  return `Build request:\n${originalPrompt}\n\nThis is correction attempt ${attempt}. The deterministic factory rejected the prior submission. Fix the evidence below instead of repeating the prior structure.\n\nREJECTION EVIDENCE:\n${error}\n\nHard contract reminders:\n- Return exactly one complete JSON object.\n- inputs contains strings only.\n- designRationale and unresolvedQuestions are arrays of strings.\n- joints use parentPartId, childPartId, and type; otherwise use joints: [].\n- Do not nest arbitrary operation arrays inside parameters.\n- outputOperationId must exist for every part.\n- Use one consistent coordinate frame across all parts.\n- Derive feature centers from the requested dimensions and the chosen origin.\n- Transform translations are relative placements, not absolute coordinates.\n- A circle whose input is an extrude represents a subtractive hole cut through that solid; do not create a cylinder or leave it as a sketch-only feature.\n- For a 100x60 plate centered at the origin, 6mm diameter holes 10mm from the corners are at (-40,-20), (40,-20), (-40,20), (40,20).\n- For 20x20 blocks centered on the left/right edges of that plate, use centerX=-40 and +40 (centerY=0), not +/-50.\n- Never attempt to reference sketchCurves from a BRepBody.\n- Keep repeated physical parts distinct in both geometry and placement; names alone are not sufficient.\n- Do not claim verificationStatus=verified unless the factory has actually verified the result.\n\nReturn ONLY the corrected JSON object.`;
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
        design = normalizeRobotDesignModelOutput(content);
        design = normalizeRobotDesignModelOutput(design);
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