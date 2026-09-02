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

function py(value: unknown): string {
  return JSON.stringify(value);
}

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
        if (sketch === "None") { unsupported.push(`${part.id}:${op.id}:rectangle-without-sketch`); break; }
        const w = Number(op.parameters.widthMm ?? 0) / 10;
        const h = Number(op.parameters.heightMm ?? 0) / 10;
        if (!(w > 0 && h > 0)) { unsupported.push(`${part.id}:${op.id}:rectangle-dimensions`); break; }
        lines.push(`${ref} = ${sketch}.sketchCurves.sketchLines.addTwoPointRectangle(adsk.core.Point3D.create(0,0,0), adsk.core.Point3D.create(${w},${h},0))`);
        break;
      }
      case "circle": {
        const sketch = op.inputs.length ? `refs[${py(op.inputs[0])}]` : "None";
        const r = Number(op.parameters.radiusMm ?? 0) / 10;
        if (sketch === "None" || !(r > 0)) { unsupported.push(`${part.id}:${op.id}:circle-input-or-radius`); break; }
        lines.push(`${ref} = ${sketch}.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(0,0,0), ${r})`);
        break;
      }
      case "extrude": {
        const sketch = op.inputs.length ? `refs[${py(op.inputs[0])}]` : "None";
        const distance = Number(op.parameters.distanceMm ?? 0) / 10;
        if (sketch === "None" || !(distance > 0)) { unsupported.push(`${part.id}:${op.id}:extrude-input-or-distance`); break; }
        lines.push(`profile = ${sketch}.profiles.item(0)`, `input = features.extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)`, `input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${distance}))`, `${ref} = features.extrudeFeatures.add(input)`, `if not ${ref}: raise RuntimeError(${py(`Extrusion failed for ${part.id}:${op.id}`)})`);
        break;
      }
      default:
        unsupported.push(`${part.id}:${op.id}:${op.op}`);
    }
  }
  lines.push(`if component.bRepBodies.count - bodiesBefore < 1: raise RuntimeError(${py(`Part ${part.id} produced no solid body`)})`);
  return { script: lines.join("\n"), unsupported };
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
    "    design = adsk.fusion.Design.cast(app.activeProduct)",
    "    if not design: raise RuntimeError('Active product is not a Fusion Design')",
    "    root = design.rootComponent",
    `    design.attributes.add('AI_FACTORY', 'robot_design_hash', ${py(designHash)})`,
    "    refs = {}",
    ...parts.flatMap(part => part.split("\n").map(line => `    ${line}`)),
    `    print('AI_FACTORY_ROBOT_CAD_RESULT')`,
    `    print('design_hash=' + ${py(designHash)})`,
    `    print('document=' + app.activeDocument.name)`,
    `    print('parts=${design.parts.length}')`,
  ].join("\n");
  return { design, designHash, script, unsupportedOperations: unsupported };
}

export async function compileRobotDesignToFusion(input: unknown): Promise<RobotCadCompileResult> {
  const compiled = compileRobotDesignToFusionScript(input);
  if (compiled.unsupportedOperations.length) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: compiled.unsupportedOperations, error: "The model-authored design contains geometry operations not yet implemented by the Fusion compiler." };
  if (!fusion.isConnected()) await fusion.connect();
  try {
    const result = await withTimeout(fusion.callTool("fusion_mcp_execute", { featureType: "script", object: { script: compiled.script } }), config.TOOL_TIMEOUT_MS, "Fusion robot CAD compilation");
    const text = typeof result === "string" ? result : JSON.stringify(result);
    const actualHash = text.match(/design_hash=([^\r\n]+)/)?.[1]?.trim();
    const document = text.match(/document=([^\r\n]+)/)?.[1]?.trim();
    const parts = Number(text.match(/parts=(\d+)/)?.[1] ?? 0);
    if (actualHash !== compiled.designHash) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: [], error: "Fusion did not return the expected design hash." };
    if (parts !== compiled.design.parts.length) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: [], error: `Fusion verified ${parts} parts; expected ${compiled.design.parts.length}.` };
    return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: true, document, createdParts: compiled.design.parts.map(part => part.id), unsupportedOperations: [] };
  } catch (error) {
    return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: [], error: error instanceof Error ? error.message : String(error) };
  }
}
