import { fusion } from "./fusion.js";
import { withTimeout } from "./execution.js";
import { config } from "./config.js";

export type CreateBoxArgs = {
  widthMm: number;
  depthMm: number;
  heightMm: number;
};

export type CreateCylinderArgs = {
  radiusMm: number;
  heightMm: number;
};

export type CreateMountingPlateArgs = {
  widthMm: number;
  depthMm: number;
  plateHeightMm: number;
  postRadiusMm: number;
  postHeightMm: number;
  insetMm: number;
};

export type CadResult = {
  success: boolean;
  operation: "create_box" | "create_cylinder" | "create_mounting_plate";
  dimensionsMm?: { width: number; depth: number; height: number };
  radiusMm?: number;
  bodies?: number;
  document?: string;
  error?: string;
};

function finitePositive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
  if (value > 10_000) throw new Error(`${name} exceeds the 10,000 mm safety limit.`);
  return value;
}

export function parseCreateBoxArgs(args: Record<string, unknown>): CreateBoxArgs {
  return {
    widthMm: finitePositive(args.widthMm, "widthMm"),
    depthMm: finitePositive(args.depthMm, "depthMm"),
    heightMm: finitePositive(args.heightMm, "heightMm")
  };
}

export function parseCreateCylinderArgs(args: Record<string, unknown>): CreateCylinderArgs {
  return {
    radiusMm: finitePositive(args.radiusMm, "radiusMm"),
    heightMm: finitePositive(args.heightMm, "heightMm")
  };
}

export function parseCreateMountingPlateArgs(args: Record<string, unknown>): CreateMountingPlateArgs {
  const parsed = {
    widthMm: finitePositive(args.widthMm, "widthMm"),
    depthMm: finitePositive(args.depthMm, "depthMm"),
    plateHeightMm: finitePositive(args.plateHeightMm, "plateHeightMm"),
    postRadiusMm: finitePositive(args.postRadiusMm, "postRadiusMm"),
    postHeightMm: finitePositive(args.postHeightMm, "postHeightMm"),
    insetMm: finitePositive(args.insetMm, "insetMm")
  };

  if (parsed.insetMm + parsed.postRadiusMm >= parsed.widthMm / 2 || parsed.insetMm + parsed.postRadiusMm >= parsed.depthMm / 2) {
    throw new Error("insetMm leaves insufficient room for the mounting posts.");
  }
  return parsed;
}

function createDesignPreamble(): string {
  return `import adsk.core, adsk.fusion\n\napp = adsk.core.Application.get()\nif not app:\n    raise RuntimeError("Fusion application unavailable")\n\ndoc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)\nproduct = app.activeProduct\ndesign = adsk.fusion.Design.cast(product)\nif not design:\n    raise RuntimeError("Active product is not a Fusion Design")\n\nroot = design.rootComponent\n`;
}

export function createBoxScript({ widthMm, depthMm, heightMm }: CreateBoxArgs): string {
  const widthCm = widthMm / 10;
  const depthCm = depthMm / 10;
  const heightCm = heightMm / 10;

  return `${createDesignPreamble()}sketch = root.sketches.add(root.xYConstructionPlane)\np1 = adsk.core.Point3D.create(0, 0, 0)\np2 = adsk.core.Point3D.create(${widthCm}, ${depthCm}, 0)\nsketch.sketchCurves.sketchLines.addTwoPointRectangle(p1, p2)\nprofile = sketch.profiles.item(0)\n\nextrudes = root.features.extrudeFeatures\nextInput = extrudes.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)\nextInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${heightCm}))\next = extrudes.add(extInput)\nif not ext:\n    raise RuntimeError("Extrusion failed")\n\nbodies = root.bRepBodies\nbodyCount = bodies.count\nif bodyCount < 1:\n    raise RuntimeError("No solid body was created")\n\nbody = bodies.item(bodyCount - 1)\nbbox = body.boundingBox\nminPoint = bbox.minPoint\nmaxPoint = bbox.maxPoint\nwidth = maxPoint.x - minPoint.x\ndepth = maxPoint.y - minPoint.y\nheight = maxPoint.z - minPoint.z\n\nprint("AI_FACTORY_CAD_RESULT")\nprint("operation=create_box")\nprint("bodies=" + str(bodyCount))\nprint("width_mm=" + str(width * 10.0))\nprint("depth_mm=" + str(depth * 10.0))\nprint("height_mm=" + str(height * 10.0))\nprint("document=" + doc.name)\n`;
}

export function createCylinderScript({ radiusMm, heightMm }: CreateCylinderArgs): string {
  const radiusCm = radiusMm / 10;
  const heightCm = heightMm / 10;

  return `${createDesignPreamble()}sketch = root.sketches.add(root.xYConstructionPlane)\ncenter = adsk.core.Point3D.create(0, 0, 0)\nsketch.sketchCurves.sketchCircles.addByCenterRadius(center, ${radiusCm})\nprofile = sketch.profiles.item(0)\n\nextrudes = root.features.extrudeFeatures\nextInput = extrudes.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)\nextInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${heightCm}))\next = extrudes.add(extInput)\nif not ext:\n    raise RuntimeError("Extrusion failed")\n\nbodies = root.bRepBodies\nbodyCount = bodies.count\nif bodyCount < 1:\n    raise RuntimeError("No solid body was created")\n\nbody = bodies.item(bodyCount - 1)\nbbox = body.boundingBox\nminPoint = bbox.minPoint\nmaxPoint = bbox.maxPoint\nwidth = maxPoint.x - minPoint.x\ndepth = maxPoint.y - minPoint.y\nheight = maxPoint.z - minPoint.z\n\nprint("AI_FACTORY_CAD_RESULT")\nprint("operation=create_cylinder")\nprint("bodies=" + str(bodyCount))\nprint("width_mm=" + str(width * 10.0))\nprint("depth_mm=" + str(depth * 10.0))\nprint("height_mm=" + str(height * 10.0))\nprint("radius_mm=" + str(${radiusMm}))\nprint("document=" + doc.name)\n`;
}

export function createMountingPlateScript({ widthMm, depthMm, plateHeightMm, postRadiusMm, postHeightMm, insetMm }: CreateMountingPlateArgs): string {
  const w = widthMm / 10;
  const d = depthMm / 10;
  const ph = plateHeightMm / 10;
  const r = postRadiusMm / 10;
  const postH = postHeightMm / 10;
  const inset = insetMm / 10;

  const points = [
    [inset, inset],
    [w - inset, inset],
    [inset, d - inset],
    [w - inset, d - inset]
  ];

  const plateSketch = `plateSketch = root.sketches.add(root.xYConstructionPlane)\nplateSketch.sketchCurves.sketchLines.addTwoPointRectangle(\nadsk.core.Point3D.create(0, 0, 0),\nadsk.core.Point3D.create(${w}, ${d}, 0))\nplateProfile = plateSketch.profiles.item(0)\nextrudes = root.features.extrudeFeatures\nplateInput = extrudes.createInput(plateProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)\nplateInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${ph}))\nplate = extrudes.add(plateInput)\nif not plate:\n    raise RuntimeError("Plate extrusion failed")\n`;

  const postSketches = points.map(([x, y], index) => `postSketch${index} = root.sketches.add(root.xYConstructionPlane)\npostSketch${index}.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(${x}, ${y}, 0), ${r})\npostProfile${index} = postSketch${index}.profiles.item(0)\npostInput${index} = extrudes.createInput(postProfile${index}, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)\npostInput${index}.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${postH}))\npost${index} = extrudes.add(postInput${index})\nif not post${index}: raise RuntimeError("Mounting post ${index + 1} extrusion failed")`).join("\n");

  return `${createDesignPreamble()}${plateSketch}${postSketches}\n\nbodies = root.bRepBodies\nbodyCount = bodies.count\nif bodyCount != 5:\n    raise RuntimeError("Expected 5 solid bodies, got " + str(bodyCount))\n\nbbox = None\nfor i in range(bodyCount):\n    bodyBox = bodies.item(i).boundingBox\n    if bbox is None:\n        bbox = bodyBox\n    else:\n        bbox.minPoint = adsk.core.Point3D.create(min(bbox.minPoint.x, bodyBox.minPoint.x), min(bbox.minPoint.y, bodyBox.minPoint.y), min(bbox.minPoint.z, bodyBox.minPoint.z))\n        bbox.maxPoint = adsk.core.Point3D.create(max(bbox.maxPoint.x, bodyBox.maxPoint.x), max(bbox.maxPoint.y, bodyBox.maxPoint.y), max(bbox.maxPoint.z, bodyBox.maxPoint.z))\n\nwidth = bbox.maxPoint.x - bbox.minPoint.x\ndepth = bbox.maxPoint.y - bbox.minPoint.y\nheight = bbox.maxPoint.z - bbox.minPoint.z\nprint("AI_FACTORY_CAD_RESULT")\nprint("operation=create_mounting_plate")\nprint("bodies=" + str(bodyCount))\nprint("width_mm=" + str(width * 10.0))\nprint("depth_mm=" + str(depth * 10.0))\nprint("height_mm=" + str(height * 10.0))\nprint("document=" + doc.name)\n`;
}

function parseToolText(result: unknown, operation: "create_box" | "create_cylinder" | "create_mounting_plate"): CadResult {
  const text = JSON.stringify(result);
  const body = text.match(/bodies=(\d+)/)?.[1];
  const width = text.match(/width_mm=([0-9.eE+-]+)/)?.[1];
  const depth = text.match(/depth_mm=([0-9.eE+-]+)/)?.[1];
  const height = text.match(/height_mm=([0-9.eE+-]+)/)?.[1];
  const radius = text.match(/radius_mm=([0-9.eE+-]+)/)?.[1];
  const document = text.match(/document=([^\\"}\r\n]+)/)?.[1];

  if (!width || !depth || !height) {
    return { success: false, operation, error: `Fusion did not return verification dimensions: ${text}` };
  }

  return {
    success: true,
    operation,
    bodies: body ? Number(body) : undefined,
    dimensionsMm: { width: Number(width), depth: Number(depth), height: Number(height) },
    radiusMm: radius ? Number(radius) : undefined,
    document
  };
}

async function executeScript(script: string, operation: CadResult["operation"]): Promise<CadResult> {
  if (!fusion.isConnected()) await fusion.connect();
  const result = await withTimeout(
    fusion.callTool("fusion_mcp_execute", { featureType: "script", object: { script } }),
    config.TOOL_TIMEOUT_MS,
    `Fusion ${operation}`
  );
  return parseToolText(result, operation);
}

export async function executeCreateBox(args: Record<string, unknown>): Promise<CadResult> {
  return executeScript(createBoxScript(parseCreateBoxArgs(args)), "create_box");
}

export async function executeCreateCylinder(args: Record<string, unknown>): Promise<CadResult> {
  return executeScript(createCylinderScript(parseCreateCylinderArgs(args)), "create_cylinder");
}

export async function executeCreateMountingPlate(args: Record<string, unknown>): Promise<CadResult> {
  return executeScript(createMountingPlateScript(parseCreateMountingPlateArgs(args)), "create_mounting_plate");
}
