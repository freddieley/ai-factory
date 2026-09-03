import { robotDesignHash, validateRobotDesign, RobotDesign, RobotJoint } from "./robot-design.js";
import { verifyRobotDesignSemantics } from "./robot-semantic-verifier.js";
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
  const w = num(parameters.widthMm ?? parameters.width) / 10;
  const h = num(parameters.heightMm ?? parameters.height) / 10;
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
  const r = num(parameters.radiusMm ?? parameters.radius) / 10;
  const x = num(parameters.centerX) / 10;
  const y = num(parameters.centerY) / 10;
  if (!(r > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return `${sketchRef}.sketchCurves.sketchCircles.addByCenterRadius(${point(x, y)}, ${r})`;
}

function planeExpression(planeValue: unknown): string {
  const plane = String(planeValue ?? "XY").toUpperCase();
  return plane === "YZ" ? "component.yZConstructionPlane" : plane === "XZ" ? "component.xZConstructionPlane" : "component.xYConstructionPlane";
}

type TransformSpec = { rotationDeg: number; tx: number; ty: number; tz: number };

function transformSpec(parameters: Record<string, unknown>): TransformSpec | null {
  const rotationDeg = num(parameters.rotationDeg ?? parameters.rotateDeg);
  const tx = num(parameters.translateXmm ?? parameters.translateX) / 10;
  const ty = num(parameters.translateYmm ?? parameters.translateY) / 10;
  const tz = num(parameters.translateZmm ?? parameters.translateZ) / 10;
  if (!Number.isFinite(rotationDeg) || !Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) return null;
  return { rotationDeg, tx, ty, tz };
}

function transformLines(spec: TransformSpec): string[] {
  return [
    `matrix = adsk.core.Matrix3D.create()`,
    `matrix.setToRotation(${spec.rotationDeg} * 3.141592653589793 / 180.0, adsk.core.Vector3D.create(0,0,1), adsk.core.Point3D.create(0,0,0))`,
    `matrix.translation = adsk.core.Vector3D.create(${spec.tx},${spec.ty},${spec.tz})`,
    `occurrence.transform2 = matrix`,
  ];
}

function sourcePlaneExpression(operationById: Map<string, RobotDesign["parts"][number]["geometry"]["operations"][number]>, sourceId: string): string {
  let current = operationById.get(sourceId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.op === "sketch") return planeExpression(current.parameters.plane);
    const nextId = current.inputs[0];
    current = nextId ? operationById.get(nextId) : undefined;
  }
  return "component.xYConstructionPlane";
}

function compilePart(part: RobotDesign["parts"][number]): { script: string; unsupported: string[] } {
  const unsupported: string[] = [];
  const operationById = new Map(part.geometry.operations.map(operation => [operation.id, operation]));
  const lines: string[] = [
    `# AI Factory part ${py(part.id)}`,
    `occurrence = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())`,
    `component = occurrence.component`,
    `component.name = ${py(part.name)}`,
    `occurrence.name = ${py(part.id)}`,
    `sketches = component.sketches`,
    `features = component.features`,
    `bodiesBefore = component.bRepBodies.count`,
    `pendingTransforms = {}`,
  ];

  for (const op of part.geometry.operations) {
    const ref = `refs[${py(op.id)}]`;
    switch (op.op) {
      case "sketch": {
        lines.push(`${ref} = sketches.add(${planeExpression(op.parameters.plane)})`);
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
        const sourceId = op.inputs[0] ?? "";
        const sourceOp = sourceId ? operationById.get(sourceId) : undefined;
        if (!sourceId || !sourceOp) {
          unsupported.push(`${part.id}:${op.id}:circle-input-or-radius`);
          break;
        }
        if (sourceOp.op === "sketch") {
          const circle = circleLine(`refs[${py(sourceId)}]`, op.parameters);
          if (!circle) {
            unsupported.push(`${part.id}:${op.id}:circle-input-or-radius`);
            break;
          }
          lines.push(circle, `${ref} = refs[${py(sourceId)}]`);
          break;
        }
        if (sourceOp.op === "extrude") {
          const circle = circleLine("holeSketch", op.parameters);
          if (!circle) {
            unsupported.push(`${part.id}:${op.id}:circle-input-or-radius`);
            break;
          }
          const cutPlane = String(op.parameters.plane ?? "").toUpperCase();
          const planeExpr = cutPlane === "XY" ? "component.xYConstructionPlane" : cutPlane === "XZ" ? "component.xZConstructionPlane" : "component.yZConstructionPlane";
          const throughAll = op.parameters.throughAll !== false;
          const extentMm = num(op.parameters.extentMm);
          lines.push(
            `holeSketch = sketches.add(${planeExpr})`,
            circle,
            `holeProfiles = holeSketch.profiles`,
            `if holeProfiles.count < 1: raise RuntimeError(${py(`Hole sketch for ${part.id}:${op.id} produced no closed profile`)})`,
            `holeProfile = holeProfiles.item(0)`,
            `cutInput = features.extrudeFeatures.createInput(holeProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)`,
            ...(throughAll
              ? [
                  `throughAllOne = adsk.fusion.ThroughAllExtentDefinition.create()`,
                  `throughAllTwo = adsk.fusion.ThroughAllExtentDefinition.create()`,
                  `if not cutInput.setTwoSidesExtent(throughAllOne, throughAllTwo): raise RuntimeError(${py(`Through-all hole cut configuration failed for ${part.id}:${op.id}`)})`,
                ]
              : [
                  `cutExtent = adsk.fusion.DistanceExtentDefinition.create(adsk.core.ValueInput.createByReal(${Math.max(extentMm, 0.1) / 10}))`,
                  `if not cutInput.setSymmetricExtent(cutExtent.distance if hasattr(cutExtent, 'distance') else adsk.core.ValueInput.createByReal(${Math.max(extentMm, 0.1) / 10}), True): raise RuntimeError(${py(`Symmetric hole cut configuration failed for ${part.id}:${op.id}`)})`,
                ]),
            `cutExtrusion = features.extrudeFeatures.add(cutInput)`,
            `if not cutExtrusion: raise RuntimeError(${py(`Hole cut failed for ${part.id}:${op.id}`)})`,
            `${ref} = refs[${py(sourceId)}]`,
            `holeCount = holeCount + 1`,
          );
        } else {
          unsupported.push(`${part.id}:${op.id}:circle-source-must-be-sketch-or-extrude`);
        }
        break;
      }
      case "extrude": {
        const profileInput = op.inputs.find(input => operationById.get(input)?.op !== "circle") ?? op.inputs[0] ?? "";
        const sketch = profileInput ? `refs[${py(profileInput)}]` : "None";
        const distance = num(op.parameters.distanceMm ?? op.parameters.distance) / 10;
        if (sketch === "None" || !(distance > 0)) { unsupported.push(`${part.id}:${op.id}:extrude-input-or-distance`); break; }
        lines.push(
          `profiles = ${sketch}.profiles`,
          `if profiles.count < 1: raise RuntimeError(${py(`Sketch for ${part.id}:${op.id} produced no closed profiles`)})`,
          `profile = profiles.item(0)`,
          `input = features.extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)`,
          `input.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${distance}))`,
          `extrusion = features.extrudeFeatures.add(input)`,
          `if not extrusion: raise RuntimeError(${py(`Extrusion failed for ${part.id}:${op.id}`)})`,
          `if extrusion.bodies.count < 1: raise RuntimeError(${py(`Extrusion produced no body for ${part.id}:${op.id}`)})`,
          `body = extrusion.bodies.item(0)`,
          `refs[${py(op.id)}] = body`,
          `pending = pendingTransforms.get(${py(op.id)})`,
          `if pending:`,
          `    rotationDeg, tx, ty, tz = pending`,
          `    matrix = adsk.core.Matrix3D.create()`,
          `    matrix.setToRotation(rotationDeg * 3.141592653589793 / 180.0, adsk.core.Vector3D.create(0,0,1), adsk.core.Point3D.create(0,0,0))`,
          `    matrix.translation = adsk.core.Vector3D.create(tx,ty,tz)`,
          `    occurrence.transform2 = matrix`,
          `    pendingTransforms.pop(${py(op.id)}, None)`,
        );
        break;
      }
      case "transform": {
        const sourceId = op.inputs.length ? op.inputs[0] : "";
        if (!sourceId || !operationById.has(sourceId)) {
          unsupported.push(`${part.id}:${op.id}:transform-input`);
          break;
        }
        const spec = transformSpec(op.parameters);
        if (!spec) {
          unsupported.push(`${part.id}:${op.id}:transform-parameters`);
          break;
        }
        const sourceRef = `refs[${py(sourceId)}]`;
        const sourceOp = operationById.get(sourceId);
        if (sourceOp?.op === "extrude") {
          lines.push(...transformLines(spec), `${ref} = ${sourceRef}`);
        } else {
          lines.push(`pendingTransforms[${py(sourceId)}] = (${spec.rotationDeg}, ${spec.tx}, ${spec.ty}, ${spec.tz})`, `${ref} = ${sourceRef}`);
        }
        break;
      }
      default:
        unsupported.push(`${part.id}:${op.id}:${op.op}`);
    }
  }
  lines.push(
    `if component.bRepBodies.count - bodiesBefore < 1: raise RuntimeError(${py(`Part ${part.id} produced no solid body`)})`,
    `createdBodies += component.bRepBodies.count - bodiesBefore`,
  );
  return { script: lines.join("\n"), unsupported };
}

function jointDirectionExpression(value: unknown): string {
  switch (String(value ?? "Z").toUpperCase()) {
    case "X": return "adsk.fusion.JointDirections.XAxisJointDirection";
    case "Y": return "adsk.fusion.JointDirections.YAxisJointDirection";
    default: return "adsk.fusion.JointDirections.ZAxisJointDirection";
  }
}

function compileAssemblyJoints(design: RobotDesign): { script: string; unsupported: string[] } {
  const unsupported: string[] = [];
  if (design.joints.length === 0) return { script: "", unsupported };
  const partIndex = new Map(design.parts.map((part, index) => [part.id, index]));
  const lines: string[] = [
    "# AI Factory assembly constraints",
    "occurrences = root.occurrences",
    "jointCreatedIds = []",
    "for i in range(1, occurrences.count): occurrences.item(i).isGroundToParent = False",
  ];
  design.joints.forEach((joint, index) => {
    const parentIndex = partIndex.get(joint.parentPartId);
    const childIndex = partIndex.get(joint.childPartId);
    if (parentIndex === undefined || childIndex === undefined) { unsupported.push(`joint:${joint.id}:unknown-part`); return; }
    const p = joint.parameters;
    const anchorX = num(p.anchorXmm ?? p.xMm ?? p.x) / 10;
    const anchorY = num(p.anchorYmm ?? p.yMm ?? p.y) / 10;
    const anchorZ = num(p.anchorZmm ?? p.zMm ?? p.z);
    if (anchorZ !== 0) unsupported.push(`joint:${joint.id}:anchorZ-not-supported-by-sketch-point`);
    const axis = jointDirectionExpression(p.axis ?? p.jointAxis);
    const parent = `parentOcc${index}`; const child = `childOcc${index}`;
    const parentSketch = `parentJointSketch${index}`; const childSketch = `childJointSketch${index}`;
    const parentPoint = `parentJointPoint${index}`; const childPoint = `childJointPoint${index}`;
    const parentGeo = `parentJointGeo${index}`; const childGeo = `childJointGeo${index}`;
    const input = `jointInput${index}`; const created = `joint${index}`;
    lines.push(
      `${parent} = occurrences.item(${parentIndex})`, `${child} = occurrences.item(${childIndex})`,
      `if not ${parent} or not ${child}: raise RuntimeError(${py(`Joint ${joint.id} could not resolve component occurrences`)})`,
      `${parentSketch} = ${parent}.component.sketches.add(${parent}.component.xYConstructionPlane)`,
      `${childSketch} = ${child}.component.sketches.add(${child}.component.xYConstructionPlane)`,
      `${parentPoint} = ${parentSketch}.sketchPoints.add(adsk.core.Point3D.create(${anchorX},${anchorY},0))`,
      `${childPoint} = ${childSketch}.sketchPoints.add(adsk.core.Point3D.create(${anchorX},${anchorY},0))`,
      `${parentPoint} = ${parentPoint}.createForAssemblyContext(${parent})`, `${childPoint} = ${childPoint}.createForAssemblyContext(${child})`,
      `${parentGeo} = adsk.fusion.JointGeometry.createByPoint(${parentPoint})`, `${childGeo} = adsk.fusion.JointGeometry.createByPoint(${childPoint})`,
      `if not ${parentGeo} or not ${childGeo}: raise RuntimeError(${py(`Joint ${joint.id} geometry creation failed`)})`,
      `${input} = root.joints.createInput(${parentGeo}, ${childGeo})`,
      `if not ${input}: raise RuntimeError(${py(`Joint ${joint.id} input creation failed`)})`,
    );
    switch (joint.type) {
      case "fixed": lines.push(`if not ${input}.setAsRigidJointMotion(): raise RuntimeError(${py(`Joint ${joint.id} rigid configuration failed`)})`); break;
      case "revolute": lines.push(`if not ${input}.setAsRevoluteJointMotion(${axis}): raise RuntimeError(${py(`Joint ${joint.id} revolute configuration failed`)})`); break;
      case "prismatic": lines.push(`if not ${input}.setAsSliderJointMotion(${axis}): raise RuntimeError(${py(`Joint ${joint.id} slider configuration failed`)})`); break;
      case "spherical": lines.push(`if not ${input}.setAsBallJointMotion(adsk.fusion.JointDirections.ZAxisJointDirection, adsk.fusion.JointDirections.XAxisJointDirection): raise RuntimeError(${py(`Joint ${joint.id} ball configuration failed`)})`); break;
      case "planar": lines.push(`if not ${input}.setAsPlanarJointMotion(${axis}): raise RuntimeError(${py(`Joint ${joint.id} planar configuration failed`)})`); break;
    }
    const offsetMm = num(p.offsetMm); const angleDeg = num(p.angleDeg);
    if (offsetMm !== 0) lines.push(`${input}.offset = adsk.core.ValueInput.createByString(${py(`${offsetMm} mm`)})`);
    if (angleDeg !== 0) lines.push(`${input}.angle = adsk.core.ValueInput.createByString(${py(`${angleDeg} deg`)})`);
    if (p.flipped === true) lines.push(`${input}.isFlipped = True`);
    lines.push(`${created} = root.joints.add(${input})`, `if not ${created}: raise RuntimeError(${py(`Fusion failed to create joint ${joint.id}`)})`, `${created}.name = ${py(joint.id)}`, `jointCreatedIds.append(${py(joint.id)})`);
    const min = p.minimum; const max = p.maximum;
    if (min !== undefined || max !== undefined) {
      lines.push(`motion${index} = ${created}.jointMotion`, `if not motion${index}: raise RuntimeError(${py(`Joint ${joint.id} has no motion object`)})`);
      if (joint.type === "revolute") lines.push(`limits${index} = motion${index}.rotationLimits`);
      else if (joint.type === "prismatic") lines.push(`limits${index} = motion${index}.slideLimits`);
      else lines.push(`limits${index} = None`);
      lines.push(`if limits${index}:`);
      if (min !== undefined) lines.push(`    limits${index}.isMinimumValueEnabled = True`, `    limits${index}.minimumValue = ${num(min)}`);
      if (max !== undefined) lines.push(`    limits${index}.isMaximumValueEnabled = True`, `    limits${index}.maximumValue = ${num(max)}`);
    }
  });
  lines.push(`if len(jointCreatedIds) != ${design.joints.length}: raise RuntimeError(${py("Fusion assembly joint count mismatch")})`, `print('joint_count=' + str(len(jointCreatedIds)))`, `print('joint_ids=' + ','.join(jointCreatedIds))`);
  return { script: lines.join("\n"), unsupported };
}

export function extractFusionToolText(result: unknown): string {
  const decode = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object") return decode(parsed);
      } catch { /* raw tool text */ }
      return value;
    }
    if (Array.isArray(value)) {
      const parts = value.map(decode).filter((part): part is string => Boolean(part));
      return parts.length ? parts.join("\n") : undefined;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.content !== undefined) {
        const content = decode(record.content);
        if (content) return content;
      }
      if (record.structuredContent !== undefined) {
        const structured = decode(record.structuredContent);
        if (structured) return structured;
      }
      if (typeof record.message === "string") return decode(record.message);
      if (typeof record.text === "string") return decode(record.text);
    }
    return undefined;
  };
  return decode(result) ?? JSON.stringify(result);
}

function cleanupFusionDocumentScript(designHash: string): string {
  return [
    "import adsk.core",
    "def run(_context: str):",
    "    app = adsk.core.Application.get()",
    "    for i in range(app.documents.count - 1, -1, -1):",
    "        doc = app.documents.item(i)",
    `        attr = doc.attributes.itemByName('AI_FACTORY', 'robot_design_hash') if doc else None`,
    `        if attr and attr.value == ${py(designHash)}:`,
    "            doc.close(False)",
    `            print('AI_FACTORY_ROBOT_CAD_CLEANUP\ndesign_hash=${designHash}\nclosed=true')`,
    "            return",
    `    print('AI_FACTORY_ROBOT_CAD_CLEANUP\ndesign_hash=${designHash}\nclosed=false')`,
  ].join("\n");
}

async function cleanupFailedFusionDocument(designHash: string): Promise<void> {
  try {
    if (!fusion.isConnected()) await fusion.connect();
    await withTimeout(
      fusion.callTool("fusion_mcp_execute", { featureType: "script", object: { script: cleanupFusionDocumentScript(designHash) } }),
      config.TOOL_TIMEOUT_MS,
      "Fusion failed CAD cleanup",
    );
  } catch {
    // Cleanup is best-effort; preserve the original CAD failure.
  }
}

export function compileRobotDesignToFusionScript(input: unknown): { design: RobotDesign; designHash: string; script: string; unsupportedOperations: string[] } {
  const design = validateRobotDesign(input);
  const semantic = verifyRobotDesignSemantics(design);
  if (!semantic.success) throw new Error(`Robot semantic verification failed: ${semantic.errors.join(" ")}`);
  const designHash = robotDesignHash(design);
  const unsupported: string[] = [];
  const parts: string[] = [];
  for (const part of design.parts) { const result = compilePart(part); parts.push(result.script); unsupported.push(...result.unsupported); }
  const assembly = compileAssemblyJoints(design);
  unsupported.push(...assembly.unsupported);
  const expectedCuts = design.parts.reduce((total, part) => {
    const byId = new Map(part.geometry.operations.map(operation => [operation.id, operation]));
    return total + part.geometry.operations.filter(operation => operation.op === "circle" && operation.inputs.length > 0 && byId.get(operation.inputs[0])?.op === "extrude").length;
  }, 0);
  const script = [
    "import adsk.core, adsk.fusion", "def run(_context: str):", "    app = adsk.core.Application.get()", "    if not app: raise RuntimeError('Fusion application unavailable')", "    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)", "    design = adsk.fusion.Design.cast(app.activeProduct)", "    if not design: raise RuntimeError('New Fusion Design could not be activated')", "    root = design.rootComponent",
    `    design.attributes.add('AI_FACTORY', 'robot_design_hash', ${py(designHash)})`, `    doc.attributes.add('AI_FACTORY', 'robot_design_hash', ${py(designHash)})`,
    "    refs = {}", "    createdBodies = 0", "    holeCount = 0",
    ...parts.flatMap(part => part.split("\n").map(line => `    ${line}`)),
    ...(assembly.script ? assembly.script.split("\n").map(line => `    ${line}`) : []),
    `    actualParts = root.occurrences.count`, `    actualJoints = root.joints.count`, `    print('AI_FACTORY_ROBOT_CAD_RESULT')`, `    print('design_hash=' + ${py(designHash)})`, `    print('document=' + app.activeDocument.name)`, `    print('parts=' + str(actualParts))`, `    print('bodies=' + str(createdBodies))`, `    print('cuts=' + str(holeCount))`, `    print('joints=' + str(actualJoints))`, `    print('semantic_warnings=' + ${py(semantic.warnings.join(" | "))})`,
  ].join("\n");
  return { design, designHash, script, unsupportedOperations: unsupported };
}

export async function compileRobotDesignToFusion(input: unknown): Promise<RobotCadCompileResult> {
  let compiled: ReturnType<typeof compileRobotDesignToFusionScript>;
  try {
    compiled = compileRobotDesignToFusionScript(input);
  } catch (error) {
    return { schema: "ai-factory.robot-cad-compile/v1", designHash: "", success: false, createdParts: [], unsupportedOperations: [], error: error instanceof Error ? error.message : String(error) };
  }
  if (compiled.unsupportedOperations.length) return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: compiled.unsupportedOperations, error: "The model-authored design contains geometry or assembly features not supported by the Fusion compiler." };
  const expectedCuts = compiled.design.parts.reduce((total, part) => {
    const byId = new Map(part.geometry.operations.map(operation => [operation.id, operation]));
    return total + part.geometry.operations.filter(operation => operation.op === "circle" && operation.inputs.length > 0 && byId.get(operation.inputs[0])?.op === "extrude").length;
  }, 0);
  if (!fusion.isConnected()) await fusion.connect();
  const fail = async (error: string): Promise<RobotCadCompileResult> => {
    await cleanupFailedFusionDocument(compiled.designHash);
    return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: false, createdParts: [], unsupportedOperations: [], error };
  };
  try {
    const result = await withTimeout(fusion.callTool("fusion_mcp_execute", { featureType: "script", object: { script: compiled.script } }), config.TOOL_TIMEOUT_MS, "Fusion robot CAD compilation");
    const text = extractFusionToolText(result);
    const actualHash = text.match(/design_hash=([^\r\n]+)/)?.[1]?.trim();
    const document = text.match(/document=([^\r\n]+)/)?.[1]?.trim();
    const parts = Number(text.match(/parts=(\d+)/)?.[1] ?? 0);
    const bodies = Number(text.match(/bodies=(\d+)/)?.[1] ?? 0);
    const cuts = Number(text.match(/cuts=(\d+)/)?.[1] ?? 0);
    const joints = Number(text.match(/joints=(\d+)/)?.[1] ?? 0);
    if (actualHash !== compiled.designHash) return await fail(`Fusion did not return the expected design hash. Raw result: ${text.slice(0,1000)}`);
    if (parts !== compiled.design.parts.length) return await fail(`Fusion verified ${parts} parts; expected ${compiled.design.parts.length}.`);
    if (bodies < compiled.design.parts.length) return await fail(`Fusion verified ${bodies} solid bodies; expected at least ${compiled.design.parts.length}.`);
    if (cuts !== expectedCuts) return await fail(`Fusion verified ${cuts} hole cuts; expected ${expectedCuts}.`);
    if (joints !== compiled.design.joints.length) return await fail(`Fusion verified ${joints} assembly joints; expected ${compiled.design.joints.length}.`);
    return { schema: "ai-factory.robot-cad-compile/v1", designHash: compiled.designHash, success: true, document, createdParts: compiled.design.parts.map(part => part.id), unsupportedOperations: [] };
  } catch (error) {
    return await fail(error instanceof Error ? error.message : String(error));
  }
}
