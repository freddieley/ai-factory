import type { RobotDesign, RobotGeometryOperation } from "./robot-design.js";

export type RobotSemanticVerification = {
  success: boolean;
  errors: string[];
  warnings: string[];
};

const PLANES = new Set(["XY", "XZ", "YZ"]);
const PLANE_AXIS: Record<string, string> = { XY: "Z", XZ: "Y", YZ: "X" };

function operationMap(part: RobotDesign["parts"][number]): Map<string, RobotGeometryOperation> {
  return new Map(part.geometry.operations.map(operation => [operation.id, operation]));
}

function sourceSketchPlane(operations: Map<string, RobotGeometryOperation>, sourceId: string): string {
  let current = operations.get(sourceId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.op === "sketch") return String(current.parameters.plane ?? "XY").toUpperCase();
    const next = current.inputs[0];
    current = next ? operations.get(next) : undefined;
  }
  return "XY";
}

export function verifyRobotDesignSemantics(design: RobotDesign): RobotSemanticVerification {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const part of design.parts) {
    const operations = operationMap(part);
    for (const operation of part.geometry.operations) {
      if (operation.op === "sketch") {
        const plane = String(operation.parameters.plane ?? "XY").toUpperCase();
        if (!PLANES.has(plane)) errors.push(`${part.id}:${operation.id}:unsupported sketch plane ${plane}; use XY, XZ, or YZ.`);
      }

      if (operation.op !== "circle" || operation.inputs.length === 0) continue;
      const source = operations.get(operation.inputs[0]);
      if (!source) continue;

      const explicitPlane = operation.parameters.plane;
      if (source.op === "extrude") {
        if (typeof explicitPlane !== "string" || !PLANES.has(explicitPlane.toUpperCase())) {
          errors.push(`${part.id}:${operation.id}:circular cut must explicitly declare plane (XY, XZ, or YZ) so its cut axis is unambiguous.`);
          continue;
        }
        const plane = explicitPlane.toUpperCase();
        const axis = String(operation.parameters.axis ?? PLANE_AXIS[plane]).toUpperCase();
        if (axis !== PLANE_AXIS[plane]) errors.push(`${part.id}:${operation.id}:plane ${plane} defines a ${PLANE_AXIS[plane]}-axis cut; axis ${axis} is inconsistent.`);
        const sourcePlane = sourceSketchPlane(operations, source.id);
        if (!PLANES.has(sourcePlane)) errors.push(`${part.id}:${operation.id}:source extrusion has invalid sketch plane ${sourcePlane}.`);
        if (operation.parameters.throughAll === false && !(Number(operation.parameters.extentMm) > 0)) {
          errors.push(`${part.id}:${operation.id}:circular cut must use throughAll=true or a positive extentMm.`);
        }
        if (plane !== sourcePlane && operation.parameters.throughAll !== true && !(Number(operation.parameters.extentMm) > 0)) {
          errors.push(`${part.id}:${operation.id}:cross-plane circular cut must explicitly use throughAll=true or a positive extentMm.`);
        }
      }
    }
  }

  const placedPartIds = new Set<string>();
  for (const part of design.parts) {
    for (const operation of part.geometry.operations) {
      if (operation.op !== "transform") continue;
      const hasPlacement = ["translateXmm", "translateX", "translateYmm", "translateY", "translateZmm", "translateZ", "rotationDeg", "rotateDeg", "rotationXDeg", "rotationYDeg", "rotationZDeg"]
        .some(key => typeof operation.parameters[key] === "number" && Number.isFinite(operation.parameters[key] as number));
      if (hasPlacement) placedPartIds.add(part.id);
    }
  }
  if (placedPartIds.size === 0 && design.parts.length > 1) {
    warnings.push("Multiple parts are present but no explicit transform placements were authored; verify that profile coordinates are intentionally distinct and assembly relationships are physically supported.");
  }

  return { success: errors.length === 0, errors, warnings };
}
