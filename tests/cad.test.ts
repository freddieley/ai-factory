import { describe, expect, it } from "vitest";
import { createBoxScript, createEnclosureScript, parseCreateBoxArgs, parseCreateEnclosureArgs } from "../src/cad.js";

describe("deterministic CAD executor", () => {
  it("validates positive millimetre dimensions", () => {
    expect(parseCreateBoxArgs({ widthMm: 50, depthMm: 40, heightMm: 5 })).toEqual({
      widthMm: 50,
      depthMm: 40,
      heightMm: 5
    });
  });

  it("rejects unsafe dimensions", () => {
    expect(() => parseCreateBoxArgs({ widthMm: 0, depthMm: 40, heightMm: 5 })).toThrow();
    expect(() => parseCreateBoxArgs({ widthMm: 10001, depthMm: 40, heightMm: 5 })).toThrow();
  });

  it("generates the supported Fusion document workflow", () => {
    const script = createBoxScript({ widthMm: 50, depthMm: 50, heightMm: 5 });
    expect(script).toContain("app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)");
    expect(script).toContain("product = app.activeProduct");
    expect(script).toContain("design = adsk.fusion.Design.cast(product)");
    expect(script).toContain("addTwoPointRectangle(p1, p2)");
    expect(script).toContain("createByReal(0.5)");
    expect(script).toContain("extInput = extrudes.createInput(");
    expect(script).toContain("extrudes.add(extInput)");
    expect(script).not.toContain("exInput = extrudes.createInput(");
    expect(script).not.toContain("Design.get");
    expect(script).not.toContain("Design.create");
  });

  it("validates enclosure wall geometry", () => {
    expect(parseCreateEnclosureArgs({ widthMm: 100, depthMm: 80, baseHeightMm: 4, wallHeightMm: 30, wallThicknessMm: 3 })).toEqual({
      widthMm: 100,
      depthMm: 80,
      baseHeightMm: 4,
      wallHeightMm: 30,
      wallThicknessMm: 3
    });
    expect(() => parseCreateEnclosureArgs({ widthMm: 10, depthMm: 10, baseHeightMm: 4, wallHeightMm: 20, wallThicknessMm: 5 })).toThrow();
  });

  it("generates a five-body open-top enclosure with the expected overall height", () => {
    const script = createEnclosureScript({ widthMm: 100, depthMm: 80, baseHeightMm: 4, wallHeightMm: 30, wallThicknessMm: 3 });
    expect(script).toContain("Expected 5 solid bodies");
    expect(script).toContain("operation=create_enclosure");
    expect(script).toContain("createByReal(0.4)");
    expect(script).toContain("createByReal(3.4)");
    expect(script).toContain("width_mm=");
    expect(script).toContain("depth_mm=");
    expect(script).toContain("height_mm=");
  });
});
