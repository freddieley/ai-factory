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

The geometry graph is the model's design representation. The model must interpret the user's requirements, dimensions, constraints, relationships, manufacturing intent, and placement itself and author the appropriate graph. Do not use task-specific templates, benchmark examples, memorized dimensions, or precomputed placements.

The deterministic factory supports only the operation vocabulary exposed by the schema. Use those operations according to their semantic meaning and connect them through operation IDs. Inputs must reference operations in the graph. Do not invent operation types or compiler behavior. Keep the graph complete, acyclic, internally consistent, and sufficient to represent the requested design.

Use a consistent coordinate system. Establish an origin and orientation that make the design easy to reason about, then derive all dimensions and placements from the user's requirements. Do not invent a second coordinate frame midway through a design. A transform is a relative placement of the geometry it receives; account for the accumulated placement when reasoning about subsequent features.

Sketches represent profiles on a plane. Rectangles, circles, and other supported profile operations should be used to represent the requested cross-sections. An extrusion turns an appropriate profile into a solid. A circular feature applied to an existing solid may represent a subtractive cut when that is what the requested design semantics require. Do not assume that every circular feature is a new solid body.

Do not reference CAD implementation details that the model cannot infer from the schema. In particular, do not assume sketch-only objects or BRep bodies expose sketch-specific collections. The factory owns CAD API mechanics.

When repeated components are required, make every instance physically distinct through its authored geometry and/or placement. Names alone do not create distinct physical parts.

DesignRationale and unresolvedQuestions are arrays of strings. Joints, when needed, use {id,parentPartId,childPartId,type}, where type is fixed, revolute, prismatic, spherical, or planar. Use joints: [] when no assembly relationship is required.

Do not claim verificationStatus=verified unless the factory has actually verified the result. The final graph must represent the requested geometry rather than placeholders. Make conservative engineering assumptions when the request is underspecified and record them in unresolvedQuestions. Prioritize physically sensible dimensions, manufacturability, and clear part relationships.`;

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
  return `Build request:\n${originalPrompt}\n\nThis is correction attempt ${attempt}. The deterministic factory rejected the prior submission. Re-evaluate the design from the user's requirements and fix the evidenced failure. Do not assume the prior design was conceptually correct merely because it was close to compiling.\n\nREJECTION EVIDENCE:\n${error}\n\nReturn a materially corrected design as exactly one complete JSON object matching the same schema. Preserve valid decisions from the prior attempt only when they remain justified by the request and the rejection evidence. Do not use benchmark-specific examples, hardcoded dimensions, hardcoded placements, templates, or task-specific workarounds.`;
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
