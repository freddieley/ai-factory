import { describe, expect, it } from "vitest";
import { buildDrawingDocument, canonicalDrawingDocument, renderDrawingMarkdown, renderDrawingSvg } from "../src/drawing.js";
import { createParametricBox } from "../src/parametric.js";

describe("automated mechanical drawings", () => {
  it("generates deterministic orthographic drawing metadata from a parametric model", () => {
    const model = createParametricBox("mounting plate", 200, 100, 5);
    const drawing = buildDrawingDocument(model);
    expect(drawing.schema).toBe("ai-factory.mechanical-drawing/v1");
    expect(drawing.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(drawing.views).toEqual([
      { id: "front", widthMm: 200, heightMm: 5 },
      { id: "top", widthMm: 200, heightMm: 100 },
      { id: "right", widthMm: 100, heightMm: 5 },
    ]);
    expect(canonicalDrawingDocument(drawing)).toBe(canonicalDrawingDocument(buildDrawingDocument(model)));
  });

  it("renders reproducible markdown and SVG deliverables", () => {
    const drawing = buildDrawingDocument(createParametricBox("plate", 20, 10, 2));
    const markdown = renderDrawingMarkdown(drawing);
    const svg = renderDrawingSvg(drawing);
    expect(markdown).toContain("# plate");
    expect(markdown).toContain("| front | 20 | 2 |");
    expect(svg).toContain('data-view="front"');
    expect(svg).toContain('data-view="top"');
    expect(svg).toContain('data-view="right"');
    expect(svg).toContain(drawing.sourceHash.slice(0, 12));
  });

  it("rejects drawing generation when the source has no drawable box feature", () => {
    expect(() => buildDrawingDocument({
      schema: "ai-factory.parametric-mechanical/v1",
      name: "hole only",
      units: "mm",
      parameters: [{ name: "d", valueMm: 5 }],
      features: [{ type: "through_hole", name: "hole", diameter: "d", x: "d", y: "d" }],
    })).toThrow(/box feature/);
  });
});
