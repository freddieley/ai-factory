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

function compilePart(part: RobotDesign["parts"][number]): { script: string; unsupported: string[] } {
  const unsupported: string[] = [];
  const lines: string[] = [
    `# AI Factory part ${py(part.id)}`,
    `component = root.occurrences.addNewComponent(adsk.core.Matrix3D.create()).component`,
    `component.name = ${py(part.name)}`,
    `sketches = component.sketches`,
    `features = component.features`,
    `bodiesBefore = component.bRepBodies.count`,
  ];
  for (const op of part.geometry.operations) {
    const ref = `refs[${py(op.id)}]`;
    switch (op.op) {
      case "sketch": {
        const plane = String(op.parameters.plane ?? "XY").toUpperCase();
        const planeExpr = plane === "YZ" ? "component.yZConstructionPlane" : plane === "XZ" ? "component.xZConstructionPlane" : "component.xYConstructionPlane";
        lines.push(`${ref} = sketches.add(${planeExpr})`);
        break;
      }
      case "rectangle": {
        const sketch = op.inputs.length ? `refs[${py(op.inputs[0])}]` : "None";
        const w = Number(op.parameters.widthMm ?? 0) / 10;
        const h = Number(op.parameters.heightMm ?? 0) / 10;
        const cx = Number(op.parameters.centerX ?? 0) / 10;
        const cy = Number(op.parameters.centerY ?? 0) / 10;
        const rotationDeg = Number(op.parameters.rotationDeg ?? 0);
        if (sketch === "None" || !(w > 0 && h > 0) || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(rotationDeg)) { unsupported.push(`${part.id}:${op.id}:rectangle-dimensions`); break; }
        const angle = rotationDeg * Math.PI / 180;
        const local = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
        const corners = local.map(([x, y]) => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]);
        for (let i = 0; i < corners.length; i++) {
          const a = corners[i]; const b = corners[(i + 1) % corners.length];
          lines.push(`${sketch}.sketchCurves.sketchLines.addByTwoPoints(${point(a[0], a[1])}, ${point(b[0], b[1])})`);
        }
        lines.push(`${ref} = ${sketch}`);
        break;
      }
      case "circle": {
        const sketch = op.inputs.length ? `refs[${py(op.inputs[0])}]` : "None";
        const r = Number(op.parameters.radiusMm ?? 0) / 10;
        const x = Number(op.parameters.centerX ?? 0) / 10;
        const y = Number(op.parameters.centerY ?? 0) / 10;
        if (sketch === "None" || !(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) { unsupported.push(`${part.id}:${op.id}:circle-input-or-radius`); break; }
        lines.push(`${sketch}.sketchCurves.sketchCircles.addByCenterRadius(${point(x, y)}, ${r})`, `${ref} = ${sketch}`);
        break;
      }
      case "extrude": {
        const sketch = op.inputs.length ? `refs[${py(op.inputs[0])}]` : "None";
        const distance = Number(op.parameters.distanceMm ?? 0) / 10;
        if (sketch === "None" || !(distance > 0)) { unsupported.push(`${part.id}:${op.id}:extrude-input-or-distance`); break; }
        lines.push(`profile = ${sketch}.profiles.item(0)`, `input = features.extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)`, `input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${distance}))`, `${ref} = features.extrudeFeatures.add(input)`, `if not ${ref}: raise RuntimeError(${py(`Extrusion failed for ${part.id}:${op.id}`)})`);
        break;
      }
      case "transform": {
        const source = op.inputs.length ? `refs[${py(op.inputs[0])}]` : "None";
        const rotationDeg = Number(op.parameters.rotationDeg ?? 0);
        const tx = Number(op.parameters.translateXmm ?? 0) / 10;
        const ty = Number(op.parameters.translateYmm ?? 0) / 10;
        if (source === "None" || !Number.isFinite(rotationDeg) || !Number.isFinite(tx) || !Number.isFinite(ty)) { unsupported.push(`${part.id}:${op.id}:transform-input-or-parameters`); break; }
        lines.push(`body = ${source}.bodies.item(0)`, `matrix = adsk.core.Matrix3D.create()`, `matrix.setToRotation(${rotationDeg} * 3.141592653589793 / 180.0, adsk.core.Vector3D.create(0,0,1), adsk.core.Point3D.create(0,0,0))`, `matrix.translation = adsk.core.Vector3D.create(${tx},${ty},0)`, `if not body.transformBy(matrix): raise RuntimeError(${py(`Transform failed for ${part.id}:${op.id}`)})`, `${ref} = ${source}`);
        break;
      }
      default:
        unsupported.push(`${part.id}:${op.id}:${op.op}`);
    }
  }
  lines.push(`if component.bRepBodies.count - bodiesBefore < 1: raise RuntimeError(${py(`Part ${part.id} produced no solid body`)})`);
  return { script: lines.join("\n"), unsupported };
}

function fusionToolText(result: unknown): string {
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
    ...parts.flatMap(part => part.split("\n").map(line => `    ${line}`)),
    `    print('AI_FACTORY_ROBOT_CAD_RESULT')`,
    `    print('design_hash=' + ${py(designHash)})`,
    `    print('document=' + app.activeDocument.name)`,
    `    print('parts=${design.parts.length}')`,
    `    print('bodies=' + str(root.bRepBodies.count))`,
  ].join("\n");
  return { design, designHash, script, unsupportedOperations: unsupported };
}

export async function compileRobotDesignToFusion(input: unknown): Promise<RobotCadCompileResult> {
  const compiled = compileRobotDesignToFusionScript(input);
  if (compiled.unsupportedOperations.length) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: compiled.unsupportedOperations, error: "The model-authored design contains geometry operations not yet implemented by the Fusion compiler." };
  if (!fusion.isConnected()) await fusion.connect();
  try {
    const result = await withTimeout(fusion.callTool("fusion_mcp_execute", { featureType: "script", object: { script: compiled.script } }), config.TOOL_TIMEOUT_MS, "Fusion robot CAD compilation");
    const text = fusionToolText(result);
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
