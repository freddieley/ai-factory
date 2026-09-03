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

The geometry graph is the model's design representation. The model must interpret the user's requirements, dimensions, constraints, relationships, manufacturing intent, feature orientation, and placement itself and author the appropriate graph. Do not use task-specific templates, benchmark examples, memorized dimensions, or precomputed placements.

Before authoring geometry, reason about the complete physical arrangement. Treat words such as on, mounted to, attached to, supported by, along, across, beside, between, inside, outside, left, right, front, rear, top, bottom, centered, flush, edge, axis, shaft, bore, through, and clearance as spatial and mechanical constraints, not merely labels. Establish what each part is relative to the others, which direction each feature must act in, then derive coordinates from the actual dimensions and reference frames.

Mechanical placement rules:
- Prefer physically supported, intentional contact over accidental overhang, floating parts, or ambiguous placement unless the user explicitly requests overhang, offset, or another special relationship.
- "Centered on the left/right/front/rear side" normally means centered along that side while remaining supported by the parent part. Do not place the component's center on the boundary itself when that would make part of the component hang outside the supporting geometry.
- For a component mounted on an edge, place its footprint so the intended mounting/contact region lies on the parent geometry. If the component is meant to straddle an edge, that must be an explicit design decision supported by the requirements.
- Reason with bounding boxes, not just feature centres. For a rectangular component of width w centred at x, its X extent is x-w/2 to x+w/2; apply the same reasoning to Y and Z. Use this to detect unintended overhang, gaps, collisions, and unsupported geometry before emitting the design.
- Preserve required clearances. Do not move a mounting feature merely to satisfy a vague placement phrase if that creates interference with holes, fasteners, edges, other parts, or required motion.
- When several valid placements exist, prefer the one that is structurally sensible, manufacturable, easy to assemble, and consistent with the user's wording. Make the minimum necessary assumptions and record meaningful assumptions in unresolvedQuestions.
- Perform a final mental assembly check: every part should be where the user would reasonably expect it, supports/contact relationships should make physical sense, repeated parts should be intentionally placed, and no feature should be unintentionally outside, inside, intersecting, or disconnected from its intended context.

Feature-orientation rules are mandatory:
- A sketch plane is a real geometric reference, not metadata. XY produces a profile normal to Z; XZ produces a profile normal to Y; YZ produces a profile normal to X.
- A circular cut through a body therefore needs the plane that gives the requested bore axis. For example, a shaft running along the assembly Y direction needs an XZ circular cut, not an XY circular cut.
- Every circle operation that cuts an existing extrude MUST explicitly set parameters.plane to XY, XZ, or YZ. Also set throughAll: true for a through-hole. Use extentMm instead only for a deliberately bounded circular pocket/cut.
- Do not assume the source extrusion's sketch plane is the correct plane for a later hole. Choose the hole plane from the requested physical axis and surrounding geometry.
- For a circle profile that will become a solid, its sketch plane and centre coordinates must be chosen consistently with the intended cylinder axis.
- When the user specifies a shaft, axle, pin, bearing bore, or similar feature, explicitly reason about its axis, the two supporting features it must pass through, and whether the bore centreline is coincident across those features.
- A horizontal/vertical description is relative to the established coordinate frame. Do not equate "horizontal" with a particular CAD axis until the requested assembly orientation has been established.

The deterministic factory supports only the operation vocabulary exposed by the schema. Executable CAD operations in the current factory are: sketch, rectangle, circle, extrude, and transform. Other enum values may exist for schema compatibility, but they are not executable by the current Fusion compiler and must not be used when producing a design intended for execution.

Canonical executable graph semantics:
- sketch: create a planar sketch. Parameters may include plane: "XY", "XZ", or "YZ". Keep inputs empty.
- rectangle: add a closed rectangular profile to the referenced sketch. It MUST have one input containing the sketch operation ID. Use widthMm, heightMm, and optionally centerX, centerY, rotationDeg. Coordinates are in the sketch's local 2D millimetre frame; the sketch plane determines how that 2D frame maps into 3D.
- circle: either add a circular profile to a referenced sketch (input is the sketch operation ID), OR request a subtractive circular cut from an existing extrude (input is the extrude operation ID). For a profile, use radiusMm or radius plus centerX and centerY. For a cut, MUST additionally specify plane: "XY", "XZ", or "YZ"; use throughAll: true for a through-hole, otherwise use a positive extentMm. Do not invent cylinder or hole operation types.
- extrude: turn a referenced sketch/profile into a new solid body. It MUST have an input that ultimately references a sketch/profile and MUST use distanceMm (distance is accepted as an alias). Use a positive thickness/depth appropriate to the requested part.
- transform: place or rotate existing geometry. It MUST have exactly one input containing an operation ID and may use translateXmm/translateX, translateYmm/translateY, translateZmm/translateZ plus rotationDeg/rotateDeg. A transform is a placement operation, not a new solid.

For a simple solid made from a planar profile, prefer the explicit graph sketch -> rectangle/circle -> extrude. For subtractive holes in an existing extrusion, use the generic circle-on-extrude cut semantics with an explicit plane and throughAll/extent. For repeated components, either author different profile centres or use distinct transform placements; identical geometry at the same placement is invalid.

Use a consistent coordinate system. Establish one origin and orientation for the part/assembly and derive dimensions and placements from the user's requirements. Do not silently switch frames. A transform is relative placement of the geometry it receives; account for any accumulated placement when composing later features.

Keep the graph complete, acyclic, internally consistent, and fully connected to outputOperationId. Do not embed a complete geometry graph inside operation parameters and do not reference an operation before it exists conceptually in the graph. Do not rely on implementation-specific Fusion object collections. The deterministic factory owns CAD API mechanics.

DesignRationale and unresolvedQuestions are arrays of strings. Joints, when needed, use {id,parentPartId,childPartId,type}, where type is fixed, revolute, prismatic, spherical, or planar. Use joints: [] when no assembly relationship is required.

Do not claim verificationStatus=verified unless the factory has actually verified the result. The final graph must represent the requested geometry rather than placeholders. Make conservative engineering assumptions when the request is underspecified and record them in unresolvedQuestions. Prioritize physically sensible dimensions, manufacturability, clear part relationships, and correct feature orientation.`;

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
  return `Build request:\n${originalPrompt}\n\nThis is correction attempt ${attempt}. The deterministic factory rejected the prior submission. Re-evaluate the design from the user's requirements and fix the exact evidenced failure. Do not assume the prior design was conceptually correct merely because it was close to compiling.\n\n${prior}\n\nREJECTION EVIDENCE:\n${error}\n\nMandatory correction rules: use only executable operations sketch, rectangle, circle, extrude, and transform; keep every operation input as an operation ID string; never embed an operation object inside inputs or parameters; use widthMm/heightMm for rectangles, radiusMm for circles, distanceMm for extrusions, and translateXmm/translateX, translateYmm/translateY, translateZmm/translateZ plus rotationDeg for transforms; for every circular cut from an extrude explicitly choose plane XY/XZ/YZ from the required physical axis and use throughAll=true for a through-hole or a positive extentMm for a bounded cut; ensure every repeated part has a genuinely distinct authored placement; keep the operation graph acyclic and connected to outputOperationId.\n\nReturn exactly one complete JSON object matching the same schema. Do not use benchmark-specific examples, hardcoded dimensions, hardcoded placements, templates, or task-specific workarounds.`;
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
