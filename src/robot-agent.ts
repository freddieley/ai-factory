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
Each part MUST contain id, name, material, manufacturingProcess, geometry. Geometry MUST contain schema ai-factory.robot-geometry/v1, units: "mm", operations, outputOperationId. Every operation MUST contain id, op, inputs, parameters. Operation inputs are ALWAYS operation ID strings; never inline nested operation objects.

The geometry graph is the model's design representation. Interpret the user's requirements, dimensions, constraints, relationships, manufacturing intent, and placement yourself and author the appropriate graph. Do not use task-specific templates, benchmark examples, memorized dimensions, or precomputed placements.

Executable CAD operations in the current factory are: sketch, rectangle, circle, extrude, and transform. Other enum values may exist for schema compatibility, but they are not executable by the current Fusion compiler and must not be used when producing a design intended for execution.

Canonical executable graph semantics:
- sketch: create a planar sketch. Parameters may include plane: "XY", "XZ", or "YZ". Keep inputs empty.
- rectangle: add a closed rectangular profile to the referenced sketch. It MUST have one input containing the sketch operation ID. Use widthMm, heightMm, and optionally centerX, centerY, rotationDeg. Coordinates are in the part's local millimetre frame.
- circle: either add a circular profile to a referenced sketch (input is the sketch operation ID), OR request a subtractive circular cut from an existing extrude (input is the extrude operation ID). For a cut, use radiusMm or radius plus centerX and centerY. Do not invent cylinder or hole operation types.
- extrude: turn a referenced sketch/profile into a new solid body. It MUST have an input that ultimately references a sketch/profile and MUST use distanceMm (distance is accepted as an alias). Use a positive thickness/depth appropriate to the requested part.
- transform: place or rotate existing geometry. It MUST have exactly one input containing an operation ID and may use translateXmm/translateYmm or translateX/translateY plus rotationDeg/rotateDeg. A transform is a placement operation, not a new solid.

For a simple solid made from a planar profile, prefer the explicit graph sketch -> rectangle/circle -> extrude. For subtractive holes in an existing extrusion, use the generic circle-on-extrude cut semantics. For repeated components, either author different profile centres or use distinct transform placements; identical geometry at the same placement is invalid.

Use a consistent coordinate system. Establish one origin and orientation for the part/assembly and derive dimensions and placements from the user's requirements. Do not silently switch frames. A transform is relative placement of the geometry it receives; account for any accumulated placement when composing later features.

Keep the graph complete, acyclic, internally consistent, and fully connected to outputOperationId. Do not embed a complete geometry graph inside operation parameters and do not reference an operation before it exists conceptually in the graph. Do not rely on implementation-specific Fusion object collections; the deterministic factory owns CAD API mechanics.

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

function operationParameters(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function normalizedPosition(parameters: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...parameters };
  const position = normalized.position;
  if (position && typeof position === "object" && !Array.isArray(position)) {
    const p = position as Record<string, unknown>;
    if (normalized.centerX === undefined && typeof p.x === "number") normalized.centerX = p.x;
    if (normalized.centerY === undefined && typeof p.y === "number") normalized.centerY = p.y;
    delete normalized.position;
  } else if (Array.isArray(position)) {
    if (normalized.centerX === undefined && typeof position[0] === "number") normalized.centerX = position[0];
    if (normalized.centerY === undefined && typeof position[1] === "number") normalized.centerY = position[1];
    delete normalized.position;
  }
  if (normalized.widthMm === undefined && typeof normalized.width === "number") normalized.widthMm = normalized.width;
  if (normalized.heightMm === undefined && typeof normalized.height === "number") normalized.heightMm = normalized.height;
  if (normalized.radiusMm === undefined && typeof normalized.radius === "number") normalized.radiusMm = normalized.radius;
  if (normalized.radiusMm === undefined && typeof normalized.diameter === "number") normalized.radiusMm = normalized.diameter / 2;
  return normalized;
}

function normalizeOperationAliases(rawOperation: Record<string, unknown>): Record<string, unknown>[] {
  const id = typeof rawOperation.id === "string" ? rawOperation.id : "OP";
  const op = String(rawOperation.op ?? "");
  const inputs = Array.isArray(rawOperation.inputs)
    ? rawOperation.inputs.flatMap(input => {
        if (typeof input === "string") return [input];
        if (input && typeof input === "object" && !Array.isArray(input) && typeof (input as Record<string, unknown>).id === "string") return [String((input as Record<string, unknown>).id)];
        return [];
      })
    : [];
  const parameters = normalizedPosition(operationParameters(rawOperation.parameters));

  if (op === "sketch-rectangle") {
    const profileId = `${id}-profile`;
    return [{
      id,
      op: "sketch",
      inputs: [],
      parameters: {
        plane: parameters.plane ?? "XY",
        operations: [{ id: profileId, op: "rectangle", inputs: [], parameters: {
          widthMm: parameters.widthMm,
          heightMm: parameters.heightMm,
          centerX: parameters.centerX ?? 0,
          centerY: parameters.centerY ?? 0,
          rotationDeg: parameters.rotationDeg ?? 0,
        } }],
      },
    }];
  }

  if (op === "circular-feature") {
    const mapped = { ...parameters };
    delete mapped.type;
    return [{ id, op: "circle", inputs, parameters: mapped }];
  }

  if (op === "rectangular-prism") {
    const sketchId = `${id}-sketch`;
    const profileId = `${id}-profile`;
    return [
      { id: sketchId, op: "sketch", inputs: [], parameters: { plane: "XY" } },
      { id: profileId, op: "rectangle", inputs: [sketchId], parameters: { widthMm: parameters.widthMm, heightMm: typeof rawOperation.parameters === "object" && rawOperation.parameters !== null && !Array.isArray(rawOperation.parameters) ? (rawOperation.parameters as Record<string, unknown>).depth : parameters.heightMm, centerX: parameters.centerX ?? 0, centerY: parameters.centerY ?? 0, rotationDeg: parameters.rotationDeg ?? 0 } },
      { id, op: "extrude", inputs: [profileId], parameters: { distanceMm: typeof rawOperation.parameters === "object" && rawOperation.parameters !== null && !Array.isArray(rawOperation.parameters) ? Number((rawOperation.parameters as Record<string, unknown>).height) : numParameter(parameters.heightMm) } },
    ];
  }

  if (op === "cylinder") {
    const sketchId = `${id}-sketch`;
    const profileId = `${id}-profile`;
    return [
      { id: sketchId, op: "sketch", inputs: [], parameters: { plane: "XY" } },
      { id: profileId, op: "circle", inputs: [sketchId], parameters: { radiusMm: parameters.radiusMm, centerX: parameters.centerX ?? 0, centerY: parameters.centerY ?? 0 } },
      { id, op: "extrude", inputs: [profileId], parameters: { distanceMm: typeof rawOperation.parameters === "object" && rawOperation.parameters !== null && !Array.isArray(rawOperation.parameters) ? Number((rawOperation.parameters as Record<string, unknown>).height) : 0 } },
    ];
  }

  return [{ ...rawOperation, id, op, inputs, parameters }];
}

function numParameter(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return part;
    const g = geometry as Record<string, unknown>;
    const sourceOperations = Array.isArray(g.operations) ? g.operations : [];
    const operations = sourceOperations.flatMap(rawOperation => {
      if (!rawOperation || typeof rawOperation !== "object" || Array.isArray(rawOperation)) return [rawOperation];
      return normalizeOperationAliases(rawOperation as Record<string, unknown>);
    });
    return { ...part, geometry: { ...g, operations } };
  });

  return { ...source, parts };
}

function buildRetryPrompt(originalPrompt: string, error: string, attempt: number, previousDesign: unknown): string {
  const prior = previousDesign === null ? "No prior design was accepted." : `Prior rejected design for reference:\n${compactEvidence(previousDesign, 6_000)}`;
  return `Build request:\n${originalPrompt}\n\nThis is correction attempt ${attempt}. The deterministic factory rejected the prior submission. Re-evaluate the design from the user's requirements and fix the exact evidenced failure. Do not assume the prior design was conceptually correct merely because it was close to compiling.\n\n${prior}\n\nREJECTION EVIDENCE:\n${error}\n\nMandatory correction rules: use only executable operations sketch, rectangle, circle, extrude, and transform; keep every operation input as an operation ID string; never embed an operation object inside inputs or parameters; use widthMm/heightMm for rectangles, radiusMm for circles, distanceMm for extrusions, and translateXmm/translateYmm plus rotationDeg for transforms; ensure every repeated part has a genuinely distinct authored placement; keep the operation graph acyclic and connected to outputOperationId.\n\nReturn exactly one complete JSON object matching the same schema. Do not use benchmark-specific examples, hardcoded dimensions, hardcoded placements, templates, or task-specific workarounds.`;
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
            { role: "user", content: buildRetryPrompt(prompt, previousError, attempt, previousDesign) },
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
