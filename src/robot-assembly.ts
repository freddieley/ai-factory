import { RobotDesign, RobotJoint } from "./robot-design.js";
import { config } from "./config.js";
import { fusion } from "./fusion.js";
import { withTimeout } from "./execution.js";

export type RobotAssemblyResult = {
  schema: "ai-factory.robot-assembly/v1";
  jointCount: number;
  createdJoints: string[];
  error?: string;
};

function json(value: unknown): string { return JSON.stringify(value); }
function number(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

function directionExpression(value: unknown): string {
  switch (String(value ?? "Z").toUpperCase()) {
    case "X": return "adsk.fusion.JointDirections.XAxisJointDirection";
    case "Y": return "adsk.fusion.JointDirections.YAxisJointDirection";
    default: return "adsk.fusion.JointDirections.ZAxisJointDirection";
  }
}

function jointAnchorParameters(joint: RobotJoint): { x: number; y: number } {
  return {
    x: number(joint.parameters.anchorXmm ?? joint.parameters.xMm ?? joint.parameters.x) / 10,
    y: number(joint.parameters.anchorYmm ?? joint.parameters.yMm ?? joint.parameters.y) / 10,
  };
}

function jointScript(design: RobotDesign): string {
  const partIndex = new Map(design.parts.map((part, index) => [part.id, index]));
  const lines: string[] = [
    "# AI Factory assembly joints",
    "occurrences = root.occurrences",
    "jointCreatedIds = []",
  ];

  design.joints.forEach((joint, index) => {
    const parentIndex = partIndex.get(joint.parentPartId);
    const childIndex = partIndex.get(joint.childPartId);
    if (parentIndex === undefined || childIndex === undefined) return;
    const anchor = jointAnchorParameters(joint);
    const axis = directionExpression(joint.parameters.axis ?? joint.parameters.jointAxis);
    const parentVar = `parentOcc${index}`;
    const childVar = `childOcc${index}`;
    const parentSketch = `parentJointSketch${index}`;
    const childSketch = `childJointSketch${index}`;
    const parentPoint = `parentJointPoint${index}`;
    const childPoint = `childJointPoint${index}`;
    const parentGeometry = `parentJointGeometry${index}`;
    const childGeometry = `childJointGeometry${index}`;
    const input = `jointInput${index}`;
    const created = `joint${index}`;
    lines.push(
      `${parentVar} = occurrences.item(${parentIndex})`,
      `${childVar} = occurrences.item(${childIndex})`,
      `if not ${parentVar} or not ${childVar}: raise RuntimeError(${json(`Joint ${joint.id} could not resolve both component occurrences`)})`,
      `${parentSketch} = ${parentVar}.component.sketches.add(${parentVar}.component.xYConstructionPlane)`,
      `${childSketch} = ${childVar}.component.sketches.add(${childVar}.component.xYConstructionPlane)`,
      `${parentPoint} = ${parentSketch}.sketchPoints.add(adsk.core.Point3D.create(${anchor.x},${anchor.y},0))`,
      `${childPoint} = ${childSketch}.sketchPoints.add(adsk.core.Point3D.create(${anchor.x},${anchor.y},0))`,
      `${parentPoint} = ${parentPoint}.createForAssemblyContext(${parentVar})`,
      `${childPoint} = ${childPoint}.createForAssemblyContext(${childVar})`,
      `${parentGeometry} = adsk.fusion.JointGeometry.createByPoint(${parentPoint})`,
      `${childGeometry} = adsk.fusion.JointGeometry.createByPoint(${childPoint})`,
      `if not ${parentGeometry} or not ${childGeometry}: raise RuntimeError(${json(`Joint ${joint.id} could not create joint geometry`)})`,
      `${input} = root.joints.createInput(${parentGeometry}, ${childGeometry})`,
      `if not ${input}: raise RuntimeError(${json(`Joint ${joint.id} input creation failed`)})`,
    );

    switch (joint.type) {
      case "fixed":
        lines.push(`if not ${input}.setAsRigidJointMotion(): raise RuntimeError(${json(`Joint ${joint.id} could not be configured as rigid`)})`);
        break;
      case "revolute":
        lines.push(`if not ${input}.setAsRevoluteJointMotion(${axis}): raise RuntimeError(${json(`Joint ${joint.id} could not be configured as revolute`)})`);
        break;
      case "prismatic":
        lines.push(`if not ${input}.setAsSliderJointMotion(${axis}): raise RuntimeError(${json(`Joint ${joint.id} could not be configured as slider`)})`);
        break;
      case "spherical":
        lines.push(`if not ${input}.setAsBallJointMotion(adsk.fusion.JointDirections.ZAxisJointDirection, adsk.fusion.JointDirections.XAxisJointDirection): raise RuntimeError(${json(`Joint ${joint.id} could not be configured as ball`)})`);
        break;
      case "planar":
        lines.push(`if not ${input}.setAsPlanarJointMotion(${axis}): raise RuntimeError(${json(`Joint ${joint.id} could not be configured as planar`)})`);
        break;
    }

    const offsetMm = number(joint.parameters.offsetMm);
    const angleDeg = number(joint.parameters.angleDeg);
    if (offsetMm !== 0) lines.push(`${input}.offset = adsk.core.ValueInput.createByString(${json(`${offsetMm} mm`)})`);
    if (angleDeg !== 0) lines.push(`${input}.angle = adsk.core.ValueInput.createByString(${json(`${angleDeg} deg`)})`);
    if (joint.parameters.flipped === true) lines.push(`${input}.isFlipped = True`);

    lines.push(
      `${created} = root.joints.add(${input})`,
      `if not ${created}: raise RuntimeError(${json(`Fusion failed to create joint ${joint.id}`)})`,
      `${created}.name = ${json(joint.id)}`,
      `jointCreatedIds.append(${json(joint.id)})`,
    );

    const min = joint.parameters.minimum;
    const max = joint.parameters.maximum;
    if (min !== undefined || max !== undefined) {
      lines.push(`motion${index} = ${created}.jointMotion`, `if not motion${index}: raise RuntimeError(${json(`Joint ${joint.id} has no motion object for limits`)})`);
      if (joint.type === "revolute") lines.push(`limits${index} = motion${index}.rotationLimits`);
      else if (joint.type === "prismatic") lines.push(`limits${index} = motion${index}.slideLimits`);
      else lines.push(`limits${index} = None`);
      lines.push(`if limits${index}:`);
      if (min !== undefined) lines.push(`    limits${index}.isMinimumValueEnabled = True`, `    limits${index}.minimumValue = ${number(min)}`);
      if (max !== undefined) lines.push(`    limits${index}.isMaximumValueEnabled = True`, `    limits${index}.maximumValue = ${number(max)}`);
    }
  });

  lines.push(`if len(jointCreatedIds) != ${design.joints.length}: raise RuntimeError('Fusion assembly joint count mismatch')`, `print('joint_count=' + str(len(jointCreatedIds)))`, `print('joint_ids=' + ','.join(jointCreatedIds))`);
  return lines.join("\n");
}

export function compileRobotAssemblyScript(design: RobotDesign): string {
  return [
    "import adsk.core, adsk.fusion",
    "def run(_context: str):",
    "    app = adsk.core.Application.get()",
    "    if not app: raise RuntimeError('Fusion application unavailable')",
    "    design = adsk.fusion.Design.cast(app.activeProduct)",
    "    if not design: raise RuntimeError('No active Fusion design')",
    "    root = design.rootComponent",
    ...jointScript(design).split("\n").map(line => `    ${line}`),
  ].join("\n");
}

export async function applyRobotAssembly(design: RobotDesign): Promise<RobotAssemblyResult> {
  if (design.joints.length === 0) return { schema: "ai-factory.robot-assembly/v1", jointCount: 0, createdJoints: [] };
  if (!fusion.isConnected()) await fusion.connect();
  try {
    const result = await withTimeout(
      fusion.callTool("fusion_mcp_execute", { featureType: "script", object: { script: compileRobotAssemblyScript(design) } }),
      config.TOOL_TIMEOUT_MS,
      "Fusion robot assembly",
    );
    const text = typeof result === "string" ? result : JSON.stringify(result);
    const count = Number(text.match(/joint_count=(\d+)/)?.[1] ?? 0);
    const idsText = text.match(/joint_ids=([^\r\n]*)/)?.[1] ?? "";
    const createdJoints = idsText ? idsText.split(",").filter(Boolean) : [];
    if (count !== design.joints.length || createdJoints.length !== design.joints.length) {
      return { schema: "ai-factory.robot-assembly/v1", jointCount: count, createdJoints, error: `Fusion verified ${count} assembly joints; expected ${design.joints.length}. Raw result: ${text.slice(0, 1000)}` };
    }
    return { schema: "ai-factory.robot-assembly/v1", jointCount: count, createdJoints };
  } catch (error) {
    return { schema: "ai-factory.robot-assembly/v1", jointCount: 0, createdJoints: [], error: error instanceof Error ? error.message : String(error) };
  }
}
