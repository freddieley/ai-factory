import { fusion } from "./fusion.js";
import { withTimeout } from "./execution.js";
import { config } from "./config.js";
import { positiveMm, validatePlateHole } from "./geometry.js";

export type CreatePlateArgs = { widthMm: number; depthMm: number; heightMm: number; holeDiameterMm: number; holeXmm?: number; holeYmm?: number };
export type PlateResult = { success: boolean; operation: "create_plate_with_hole"; dimensionsMm?: { width: number; depth: number; height: number }; holeDiameterMm?: number; holeCenterMm?: { x: number; y: number }; bodies?: number; document?: string; error?: string };

export function parseCreatePlateArgs(args: Record<string, unknown>): CreatePlateArgs {
  const widthMm = positiveMm(args.widthMm, "widthMm");
  const depthMm = positiveMm(args.depthMm, "depthMm");
  const heightMm = positiveMm(args.heightMm, "heightMm");
  const holeDiameterMm = positiveMm(args.holeDiameterMm, "holeDiameterMm");
  validatePlateHole(widthMm, depthMm, holeDiameterMm);
  const holeXmm = args.holeXmm === undefined ? widthMm / 2 : positiveMm(args.holeXmm, "holeXmm");
  const holeYmm = args.holeYmm === undefined ? depthMm / 2 : positiveMm(args.holeYmm, "holeYmm");
  if (holeXmm >= widthMm || holeYmm >= depthMm) throw new Error("Hole center must lie inside the plate.");
  if (holeXmm - holeDiameterMm / 2 <= 0 || holeXmm + holeDiameterMm / 2 >= widthMm || holeYmm - holeDiameterMm / 2 <= 0 || holeYmm + holeDiameterMm / 2 >= depthMm) throw new Error("Hole must leave material between its edge and the plate perimeter.");
  return { widthMm, depthMm, heightMm, holeDiameterMm, holeXmm, holeYmm };
}

export function createPlateWithHoleScript(args: CreatePlateArgs): string {
  const w = args.widthMm / 10, d = args.depthMm / 10, h = args.heightMm / 10;
  const x = (args.holeXmm ?? args.widthMm / 2) / 10, y = (args.holeYmm ?? args.depthMm / 2) / 10, r = args.holeDiameterMm / 20;
  return `import adsk.core, adsk.fusion\napp = adsk.core.Application.get()\nif not app: raise RuntimeError("Fusion application unavailable")\ndoc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)\nproduct = app.activeProduct\ndesign = adsk.fusion.Design.cast(product)\nif not design: raise RuntimeError("Active product is not a Fusion Design")\nroot = design.rootComponent\nplateSketch = root.sketches.add(root.xYConstructionPlane)\nplateSketch.sketchCurves.sketchLines.addTwoPointRectangle(adsk.core.Point3D.create(0, 0, 0), adsk.core.Point3D.create(${w}, ${d}, 0))\nplateProfile = plateSketch.profiles.item(0)\nextrudes = root.features.extrudeFeatures\nplateInput = extrudes.createInput(plateProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)\nplateInput.setDistanceExtent(False, adsk.core.ValueInput.createByReal(${h}))\nplate = extrudes.add(plateInput)\nif not plate: raise RuntimeError("Plate extrusion failed")\nbody = root.bRepBodies.item(root.bRepBodies.count - 1)\ntopFace = max((face for face in body.faces), key=lambda face: face.boundingBox.maxPoint.z)\nholeSketch = root.sketches.add(topFace)\nholeSketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(${x}, ${y}, 0), ${r})\nholeProfile = holeSketch.profiles.item(0)\nholeInput = extrudes.createInput(holeProfile, adsk.fusion.FeatureOperations.CutFeatureOperation)\nholeInput.setThroughAllExtent(adsk.fusion.ThroughAllExtentDefinition.create())\nholeCut = extrudes.add(holeInput)\nif not holeCut: raise RuntimeError("Through-hole cut failed")\nbodies = root.bRepBodies\nif bodies.count != 1: raise RuntimeError("Expected one final solid body, got " + str(bodies.count))\nfinalBody = bodies.item(0)\nbbox = finalBody.boundingBox\nprint("AI_FACTORY_CAD_RESULT")\nprint("operation=create_plate_with_hole")\nprint("bodies=" + str(bodies.count))\nprint("width_mm=" + str((bbox.maxPoint.x - bbox.minPoint.x) * 10.0))\nprint("depth_mm=" + str((bbox.maxPoint.y - bbox.minPoint.y) * 10.0))\nprint("height_mm=" + str((bbox.maxPoint.z - bbox.minPoint.z) * 10.0))\nprint("hole_diameter_mm=${args.holeDiameterMm}")\nprint("hole_x_mm=${args.holeXmm ?? args.widthMm / 2}")\nprint("hole_y_mm=${args.holeYmm ?? args.depthMm / 2}")\nprint("document=" + doc.name)\n`;
}

function parseResult(result: unknown): PlateResult {
  const text = JSON.stringify(result), body = text.match(/bodies=(\\d+)/)?.[1], width = text.match(/width_mm=([0-9.eE+-]+)/)?.[1], depth = text.match(/depth_mm=([0-9.eE+-]+)/)?.[1], height = text.match(/height_mm=([0-9.eE+-]+)/)?.[1], diameter = text.match(/hole_diameter_mm=([0-9.eE+-]+)/)?.[1], x = text.match(/hole_x_mm=([0-9.eE+-]+)/)?.[1], y = text.match(/hole_y_mm=([0-9.eE+-]+)/)?.[1], document = text.match(/document=([^\\"}\\r\\n]+)/)?.[1];
  if (!width || !depth || !height) return { success: false, operation: "create_plate_with_hole", error: `Fusion did not return verification dimensions: ${text}` };
  return { success: true, operation: "create_plate_with_hole", bodies: body ? Number(body) : undefined, dimensionsMm: { width: Number(width), depth: Number(depth), height: Number(height) }, holeDiameterMm: diameter ? Number(diameter) : undefined, holeCenterMm: x && y ? { x: Number(x), y: Number(y) } : undefined, document };
}

export async function executeCreatePlate(args: Record<string, unknown>): Promise<PlateResult> {
  const parsed = parseCreatePlateArgs(args);
  if (!fusion.isConnected()) await fusion.connect();
  const result = await withTimeout(fusion.callTool("fusion_mcp_execute", { featureType: "script", object: { script: createPlateWithHoleScript(parsed) } }), config.TOOL_TIMEOUT_MS, "Fusion create plate with hole");
  return parseResult(result);
}
