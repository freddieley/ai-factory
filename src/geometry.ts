import { z } from "zod";

export type GeometryError = {
  code: string;
  message: string;
  parameter?: string;
  actual?: number;
  minimum?: number;
  maximum?: number;
};

export const Point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type Point3 = z.infer<typeof Point3>;
export const Quaternion = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
export type Quaternion = z.infer<typeof Quaternion>;
export const Transform = z.object({ originMm: Point3.default([0, 0, 0]), rotationQuat: Quaternion.default([0, 0, 0, 1]) });
export type Transform = z.infer<typeof Transform>;
export const AxisAlignedBox = z.object({ min: Point3, max: Point3 });
export type AxisAlignedBox = z.infer<typeof AxisAlignedBox>;
export type ClearanceResult = { intersects: boolean; clearanceMm: number; axis: "x" | "y" | "z" };

export function positiveMm(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
  if (value > 10_000) throw new Error(`${name} exceeds the 10,000 mm safety limit.`);
  return value;
}

export function validatePlateHole(widthMm: number, depthMm: number, diameterMm: number): void {
  const radius = diameterMm / 2;
  if (diameterMm >= Math.min(widthMm, depthMm)) {
    const limit = Math.min(widthMm, depthMm);
    throw new Error(JSON.stringify({ code: "INVALID_GEOMETRY", constraint: "HOLE_FITS_PLATE", message: "Through-hole diameter must be smaller than both plate dimensions.", parameter: "diameterMm", actual: diameterMm, maximum: Math.max(0, limit - 0.1) } satisfies GeometryError & { constraint: string }));
  }
  if (radius >= Math.min(widthMm, depthMm) / 2) throw new Error("Hole leaves no material around the plate perimeter.");
}

function normalizedQuaternion(q: Quaternion): Quaternion {
  const norm = Math.hypot(...q);
  if (norm === 0) throw new Error("Rotation quaternion cannot have zero magnitude");
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
}

function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

function rotatePoint(point: Point3, qInput: Quaternion): Point3 {
  const q = normalizedQuaternion(qInput);
  const inverse: Quaternion = [-q[0], -q[1], -q[2], q[3]];
  const rotated = multiplyQuaternion(multiplyQuaternion(q, [point[0], point[1], point[2], 0]), inverse);
  return [rotated[0], rotated[1], rotated[2]];
}

export function validateTransform(input: unknown): Transform {
  const transform = Transform.parse(input);
  const norm = Math.hypot(...transform.rotationQuat);
  if (Math.abs(norm - 1) > 1e-6) throw new Error("Transform rotation quaternion must be normalized");
  return transform;
}

export function transformPoint(pointInput: Point3, transformInput: Transform): Point3 {
  const point = Point3.parse(pointInput);
  const transform = validateTransform(transformInput);
  const rotated = rotatePoint(point, transform.rotationQuat);
  return [rotated[0] + transform.originMm[0], rotated[1] + transform.originMm[1], rotated[2] + transform.originMm[2]];
}

export function composeTransforms(aInput: Transform, bInput: Transform): Transform {
  const a = validateTransform(aInput);
  const b = validateTransform(bInput);
  return { originMm: transformPoint(b.originMm, a), rotationQuat: normalizedQuaternion(multiplyQuaternion(a.rotationQuat, b.rotationQuat)) };
}

export function invertTransform(input: Transform): Transform {
  const transform = validateTransform(input);
  const q = transform.rotationQuat;
  const inverseRotation: Quaternion = [-q[0], -q[1], -q[2], q[3]];
  return { originMm: rotatePoint([-transform.originMm[0], -transform.originMm[1], -transform.originMm[2]], inverseRotation), rotationQuat: inverseRotation };
}

export function transformBox(boxInput: AxisAlignedBox, transformInput: Transform): AxisAlignedBox {
  const box = AxisAlignedBox.parse(boxInput);
  for (let i = 0; i < 3; i++) if (box.min[i] > box.max[i]) throw new Error("Box minimum must not exceed maximum");
  const corners: Point3[] = [];
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push(transformPoint([x, y, z], transformInput));
  return { min: [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.min(...corners.map(p => p[2]))], max: [Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1])), Math.max(...corners.map(p => p[2]))] };
}

export function analyzeClearance(aInput: AxisAlignedBox, bInput: AxisAlignedBox): ClearanceResult {
  const a = AxisAlignedBox.parse(aInput);
  const b = AxisAlignedBox.parse(bInput);
  for (const box of [a, b]) for (let i = 0; i < 3; i++) if (box.min[i] > box.max[i]) throw new Error("Box minimum must not exceed maximum");
  const gaps = [Math.max(b.min[0] - a.max[0], a.min[0] - b.max[0]), Math.max(b.min[1] - a.max[1], a.min[1] - b.max[1]), Math.max(b.min[2] - a.max[2], a.min[2] - b.max[2])];
  const axisIndex = gaps.reduce((best, gap, index) => gap > gaps[best] ? index : best, 0);
  return { intersects: gaps.every(gap => gap < 0), clearanceMm: gaps[axisIndex], axis: (["x", "y", "z"] as const)[axisIndex] };
}
