import { describe, expect, it } from "vitest";
import { analyzeClearance, composeTransforms, invertTransform, transformBox, transformPoint, validateTransform } from "../src/geometry.js";

describe("rigid geometry transforms and clearance", () => {
  it("translates points and composes transforms in parent-to-child order", () => {
    const parent = { originMm: [10, 0, 0] as [number, number, number], rotationQuat: [0, 0, 0, 1] as [number, number, number, number] };
    const child = { originMm: [0, 5, 0] as [number, number, number], rotationQuat: [0, 0, 0, 1] as [number, number, number, number] };
    expect(transformPoint([1, 2, 3], parent)).toEqual([11, 2, 3]);
    expect(composeTransforms(parent, child).originMm).toEqual([10, 5, 0]);
    expect(transformPoint([0, 0, 0], composeTransforms(parent, child))).toEqual([10, 5, 0]);
  });

  it("supports quarter-turn rotation and exact inverse recovery", () => {
    const q = Math.SQRT1_2;
    const transform = { originMm: [0, 0, 0] as [number, number, number], rotationQuat: [0, 0, q, q] as [number, number, number, number] };
    expect(transformPoint([10, 0, 0], transform).map(value => Math.round(value * 1e6) / 1e6)).toEqual([0, 10, 0]);
    const recovered = transformPoint(transformPoint([4, -2, 7], transform), invertTransform(transform));
    expect(recovered.map(value => Math.round(value * 1e6) / 1e6)).toEqual([4, -2, 7]);
  });

  it("rejects invalid transforms and transforms all box corners", () => {
    expect(() => validateTransform({ originMm: [0, 0, 0], rotationQuat: [0, 0, 0, 2] })).toThrow(/normalized/);
    const box = transformBox({ min: [0, 0, 0], max: [10, 20, 30] }, { originMm: [5, -2, 1], rotationQuat: [0, 0, 0, 1] });
    expect(box).toEqual({ min: [5, -2, 1], max: [15, 18, 31] });
  });

  it("reports signed AABB clearance and intersections", () => {
    expect(analyzeClearance({ min: [0, 0, 0], max: [10, 10, 10] }, { min: [15, 2, 2], max: [20, 8, 8] })).toEqual({ intersects: false, clearanceMm: 5, axis: "x" });
    expect(analyzeClearance({ min: [0, 0, 0], max: [10, 10, 10] }, { min: [8, 2, 2], max: [20, 8, 8] }).intersects).toBe(true);
  });
});
