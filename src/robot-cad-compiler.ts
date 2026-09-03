import { robotDesignHash, validateRobotDesign, RobotDesign } from "./robot-design.js";
import { config } from "./config.js";
import { fusion } from "./fusion.js";
import { withTimeout } from "./execution.js";

export type RobotCadCompileResult = {
  schema: "ai-factory.robot-cad-compile/v1";
  designHash: string;
  success: boolean;
  document?: string;
  createdParts: string[];
  unsupportedOperations: string[];
  error?: string;
};

function py(value: unknown): string { return JSON.stringify(value); }
function point(x: number, y: number): string { return `adsk.core.Point3D.create(${x},${y},0)`; }
function num(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

function rectangleLines(sketchRef: string, parameters: Record<string, unknown>): string[] | null {
  const w = num(parameters.widthMm) / 10;
  const h = num(parameters.heightMm) / 10;
  const cx = num(parameters.centerX) / 10;
  const cy = num(parameters.centerY) / 10;
  const rotationDeg = num(parameters.rotationDeg);
  if (!(w > 0 && h > 0) || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(rotationDeg)) return null;
  const angle = rotationDeg * Math.PI / 180;
  const local = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const corners = local.map(([x, y]) => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]);
  const lines: string[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]; const b = corners[(i + 1) % corners.length];
    lines.push(`${sketchRef}.sketchCurves.sketchLines.addByTwoPoints(${point(a[0], a[1])}, ${point(b[0], b[1])})`);
  }
  return lines;
}

function circleLine(sketchRef: string, parameters: Record<string, unknown>): string | null {
  const r = num(parameters.radiusMm) / 10;
  const x = num(parameters.centerX) / 10;
  const y = num(parameters.centerY) / 10;
  if (!(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return `${sketchRef}.sketchCurves.sketchCircles.addByCenterRadius(${point(x, y)}, ${r})`;
}

function compilePart(part: RobotDesign["parts"][number]): { script: string; unsupported: string[] } {
  const unsupported: string[] = [];
  const operationById = new Map(part.geometry.operations.map(operation => [operation.id, operation]));
  const lines: string[] = [
    `# AI Factory part ${py(part.id)}`,
    `occurrence = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())`,
    `component = occurrence.component`,
    `component.name = ${py(part.name)}`,
    `sketches = component.sketches`,
    `features = component.features`,
    `bodiesBefore = component.bRepBodies.count`,
    `pendingTransforms = {}`,
    `solidByInput = {}`,
  ];
  for (const op of part.geometry.operations) {
    const ref = `refs[${py(op.id)}]`;
    switch (op.op) {
      case "sketch": {
        const plane = String(op.parameters.plane ?? "XY").toUpperCase();
        const planeExpr = plane === "YZ" ? "component.yZConstructionPlane" : plane === "XZ" ? "component.xZConstructionPlane" : "component.xYConstructionPlane";
        lines.push(`${ref} = sketches.add(${planeExpr})`);
        const nested = Array.isArray(op.parameters.operations) ? op.parameters.operations : [];
        for (const nestedOperation of nested) {
          if (!nestedOperation || typeof nestedOperation !== "object" || Array.isArray(nestedOperation)) {
            unsupported.push(`${part.id}:${op.id}:sketch-nested-operation-shape`);
            continue;
          }
          const nestedRecord = nestedOperation as Record<string, unknown>;
          const nestedType = String(nestedRecord.op ?? "");
          const nestedParams = nestedRecord.parameters && typeof nestedRecord.parameters === "object" && !Array.isArray(nestedRecord.parameters)
            ? nestedRecord.parameters as Record<string, unknown>
            : {};
          if (nestedType === "rectangle") {
            const rectangle = rectangleLines(ref, nestedParams);
            if (rectangle) lines.push(...rectangle);
            else unsupported.push(`${part.id}:${op.id}:nested-rectangle-dimensions`);
          } else if (nestedType === "circle") {
            const circle = circleLine(ref, nestedParams);
            if (circle) lines.push(circle);
            else unsupported.push(`${part.id}:${op.id}:nested-circle-dimensions`);
          } else if (nestedType) {
            unsupported.push(`${part.id}:${op.id}:nested-${nestedType}`);
          }
        }
        break;
      }
      case "rectangle": {
        const sketch = op.inputs.length ? `refs[${py(op.inputs[0])}]` : "None";
        const rectangle = rectangleLines(sketch, op.parameters);
        if (sketch === "None" || !rectangle) {
          unsupported.push(`${part.id}:${op.id}:rectangle-dimensions`);
          break;
        }
        lines.push(...rectangle, `${ref} = ${sketch}`);
        break;
      }
      case "circle": {
        const sketch = op.inputs.length ? `refs[${py(op.inputs[0])}]` : "None";
        const circle = circleLine(sketch, op.parameters);
        if (sketch === "None" || !circle) {
          unsupported.push(`${part.id}:${op.id}:circle-input-or-radius`);
          break;
        }
        lines.push(circle, `${ref} = ${sketch}`);
        break;
      }
      case "extrude": {
        const profileInput = op.inputs.find(input => operationById.get(input)?.op !== "circle") ?? op.inputs[0] ?? "";
        const sketch = profileInput ? `refs[${py(profileInput)}]` : "None";
        const distance = num(op.parameters.distanceMm) / 10;
        if (sketch === "None" || !(distance > 0)) { unsupported.push(`${part.id}:${op.id}:extrude-input-or-distance`); break; }
        lines.push(
          `profiles = ${sketch}.profiles`,
          `if profiles.count < 1: raise RuntimeError(${py(`Sketch for ${part.id}:${op.id} produced no closed profiles`)})`,
          `extrusionsBefore = features.extrudeFeatures.count`,
          `profile = profiles.item(0)`,
          `input = features.extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)`,
          `input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${distance}))`,
          `extrusion = features.extrudeFeatures.add(input)`,
          `if not extrusion: raise RuntimeError(${py(`Extrusion failed for ${part.id}:${op.id}`)})`,
          `if extrusion.bodies.count < 1: raise RuntimeError(${py(`Extrusion produced no body for ${part.id}:${op.id}`)})`,
          `body = extrusion.bodies.item(0)`,
          `solidByInput[${py(profileInput)}] = body`,
          `solidByInput[${py(op.id)}] = body`,
          `pending = pendingTransforms.get(${py(profileInput)})`,
          `if pending:`,
          `    rotationDeg, tx, ty = pending`,
          `    matrix = adsk.core.Matrix3D.create()`,
          `    matrix.setToRotation(rotationDeg * 3.141592653589793 / 180.0, adsk.core.Vector3D.create(0,0,1), adsk.core.Point3D.create(0,0,0))`,
          `    matrix.translation = adsk.core.Vector3D.create(tx,ty,0)`,
          `    occurrence.transform2 = matrix`,
        );
        break;
      }
      case "transform": {
        const sourceId = op.inputs.length ? op.inputs[0] : "";
        const source = sourceId ? `refs[${py(sourceId)}]` : "None";
        const rotationDeg = num(op.parameters.rotationDeg ?? op.parameters.rotateDeg);
        const tx = num(op.parameters.translateXmm ?? op.parameters.translateX) / 10;
        const ty = num(op.parameters.translateYmm ?? op.parameters.translateY) / 10;
        if (source === "None" || !Number.isFinite(rotationDeg) || !Number.isFinite(tx) || !Number.isFinite(ty)) { unsupported.push(`${part.id}:${op.id}:transform-input-or-parameters`); break; }
        lines.push(
          `matrix = adsk.core.Matrix3D.create()`,
          `matrix.setToRotation(${rotationDeg} * 3.141592653589793 / 180.0, adsk.core.Vector3D.create(0,0,1), adsk.core.Point3D.create(0,0,0))`,
          `matrix.translation = adsk.core.Vector3D.create(${tx},${ty},0)`,
          `occurrence.transform2 = matrix`,
          `pendingTransforms[${py(sourceId)}] = (${rotationDeg}, ${tx}, ${ty})`,
        );
        lines.push(`${ref} = ${source}`);
        break;
      }
      default:
        unsupported.push(`${part.id}:${op.id}:${op.op}`);
    }
  }
  lines.push(`if component.bRepBodies.count - bodiesBefore < 1: raise RuntimeError(${py(`Part ${part.id} produced no solid body`)})`, `createdBodies += component.bRepBodies.count - bodiesBefore`);
  return { script: lines.join("\n"), unsupported };
}

export function extractFusionToolText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    const content = record.content;
    if (Array.isArray(content)) {
      const textParts = content.flatMap(item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const text = (item as Record<string, unknown>).text;
        return typeof text === "string" ? [text] : [];
      });
      if (textParts.length) return textParts.join("\n");
    }
    const structured = record.structuredContent;
    if (structured !== undefined) return typeof structured === "string" ? structured : JSON.stringify(structured);
    if (typeof record.message === "string") return record.message;
  }
  return JSON.stringify(result);
}

export function compileRobotDesignToFusionScript(input: unknown): { design: RobotDesign; designHash: string; script: string; unsupportedOperations: string[] } {
  const design = validateRobotDesign(input);
  const designHash = robotDesignHash(design);
  const unsupported: string[] = [];
  const parts: string[] = [];
  for (const part of design.parts) {
    const result = compilePart(part);
    parts.push(result.script);
    unsupported.push(...result.unsupported);
  }
  const script = [
    "import adsk.core, adsk.fusion",
    "def run(_context: str):",
    "    app = adsk.core.Application.get()",
    "    if not app: raise RuntimeError('Fusion application unavailable')",
    "    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)",
    "    design = adsk.fusion.Design.cast(app.activeProduct)",
    "    if not design: raise RuntimeError('New Fusion Design could not be activated')",
    "    root = design.rootComponent",
    `    design.attributes.add('AI_FACTORY', 'robot_design_hash', ${py(designHash)})`,
    `    doc.attributes.add('AI_FACTORY', 'robot_design_hash', ${py(designHash)})`,
    "    refs = {}",
    "    createdBodies = 0",
    ...parts.flatMap(part => part.split("\n").map(line => `    ${line}`)),
    `    print('AI_FACTORY_ROBOT_CAD_RESULT')`,
    `    print('design_hash=' + ${py(designHash)})`,
    `    print('document=' + app.activeDocument.name)`,
    `    print('parts=${design.parts.length}')`,
    `    print('bodies=' + str(createdBodies))`,
  ].join("\n");
  return { design, designHash, script, unsupportedOperations: unsupported };
}

export async function compileRobotDesignToFusion(input: unknown): Promise<RobotCadCompileResult> {
  const compiled = compileRobotDesignToFusionScript(input);
  if (compiled.unsupportedOperations.length) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: compiled.unsupportedOperations, error: "The model-authored design contains geometry operations not yet implemented by the Fusion compiler." };
  if (!fusion.isConnected()) await fusion.connect();
  try {
    const result = await withTimeout(fusion.callTool("fusion_mcp_execute", { featureType: "script", object: { script: compiled.script } }), config.TOOL_TIMEOUT_MS, "Fusion robot CAD compilation");
    const text = extractFusionToolText(result);
    const actualHash = text.match(/design_hash=([^\r\n]+)/)?.[1]?.trim();
    const document = text.match(/document=([^\r\n]+)/)?.[1]?.trim();
    const parts = Number(text.match(/parts=(\d+)/)?.[1] ?? 0);
    const bodies = Number(text.match(/bodies=(\d+)/)?.[1] ?? 0);
    if (actualHash !== compiled.designHash) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: [], error: `Fusion did not return the expected design hash. Raw result: ${text.slice(0,1000)}` };
    if (parts !== compiled.design.parts.length) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: [], error: `Fusion verified ${parts} parts; expected ${compiled.design.parts.length}.` };
    if (bodies < compiled.design.parts.length) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: [], error: `Fusion verified ${bodies} solid bodies; expected at least ${compiled.design.parts.length}.` };
    return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: true, document, createdParts: compiled.design.parts.map(part => part.id), unsupportedOperations: [] };
  } catch (error) {
    return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: [], error: error instanceof Error ? error.message : String(error) };
  }
}
