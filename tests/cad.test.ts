import { describe, expect, it } from "vitest";
import { createBoxScript, parseCreateBoxArgs } from "../src/cad.js";

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
    expect(script).not.toContain("Design.get");
    expect(script).not.toContain("Design.create");
  });
});
