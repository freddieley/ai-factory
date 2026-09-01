import { describe, expect, it } from "vitest";
import { createPlateWithHoleScript, parseCreatePlateArgs } from "../src/plate.js";

describe("deterministic plate-with-hole CAD primitive", () => {
  it("defaults the hole to the plate center", () => {
    expect(parseCreatePlateArgs({ widthMm: 60, depthMm: 40, heightMm: 5, holeDiameterMm: 6 })).toEqual({
      widthMm: 60,
      depthMm: 40,
      heightMm: 5,
      holeDiameterMm: 6,
      holeXmm: 30,
      holeYmm: 20
    });
  });

  it("rejects a hole that cannot fit", () => {
    expect(() => parseCreatePlateArgs({ widthMm: 20, depthMm: 20, heightMm: 5, holeDiameterMm: 50 })).toThrow(/INVALID_GEOMETRY|diameter/);
  });

  it("rejects a hole too close to an edge", () => {
    expect(() => parseCreatePlateArgs({ widthMm: 60, depthMm: 40, heightMm: 5, holeDiameterMm: 6, holeXmm: 2, holeYmm: 20 })).toThrow();
  });

  it("uses the supported active-product Fusion workflow and centimetre conversion", () => {
    const script = createPlateWithHoleScript({ widthMm: 60, depthMm: 40, heightMm: 5, holeDiameterMm: 6, holeXmm: 30, holeYmm: 20 });
    expect(script).toContain("app = adsk.core.Application.get()");
    expect(script).toContain("product = app.activeProduct");
    expect(script).toContain("design = adsk.fusion.Design.cast(product)");
    expect(script).toContain("createByReal(0.5)");
    expect(script).toContain("addByCenterRadius(");
    expect(script).toContain("Point3D.create(3, 2, 0)");
    expect(script).toContain("0.3");
    expect(script).toContain("CutFeatureOperation");
    expect(script).toContain("setThroughAllExtent");
    expect(script).toContain("operation=create_plate_with_hole");
    expect(script).toContain("hole_diameter_mm=6");
    expect(script).toContain("hole_x_mm=30");
    expect(script).toContain("hole_y_mm=20");
  });
});
