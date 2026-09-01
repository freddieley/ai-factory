import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalParametricJson, type ParametricModel, resolveLength, validateParametricModel } from "./parametric.js";

const positive = z.number().finite().positive();

export const DrawingView = z.object({
  id: z.enum(["front", "top", "right"]),
  widthMm: positive,
  heightMm: positive,
});
export type DrawingView = z.infer<typeof DrawingView>;

export const DrawingDocument = z.object({
  schema: z.literal("ai-factory.mechanical-drawing/v1"),
  title: z.string().min(1),
  units: z.literal("mm"),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  views: z.array(DrawingView).min(1),
  notes: z.array(z.string().min(1)),
});
export type DrawingDocument = z.infer<typeof DrawingDocument>;

function sourceHash(model: ParametricModel): string {
  return createHash("sha256").update(canonicalParametricJson(model)).digest("hex");
}

export function buildDrawingDocument(input: unknown): DrawingDocument {
  const model = validateParametricModel(input);
  const box = model.features.find(feature => feature.type === "box");
  if (!box) throw new Error("Drawing generation currently requires at least one box feature");

  const widthMm = resolveLength(model, box.width);
  const depthMm = resolveLength(model, box.depth);
  const heightMm = resolveLength(model, box.height);
  const holes = model.features.filter(feature => feature.type === "through_hole");

  return DrawingDocument.parse({
    schema: "ai-factory.mechanical-drawing/v1",
    title: model.name,
    units: "mm",
    sourceHash: sourceHash(model),
    views: [
      { id: "front", widthMm, heightMm },
      { id: "top", widthMm, heightMm: depthMm },
      { id: "right", widthMm: depthMm, heightMm },
    ],
    notes: [
      "Units: mm.",
      `Overall envelope: ${widthMm} × ${depthMm} × ${heightMm} mm.`,
      holes.length ? `${holes.length} through-hole feature(s) are present in the source model.` : "No through-hole features are present in the source model.",
      "Verify all dimensions and tolerances against the approved engineering model before manufacture.",
    ],
  });
}

export function renderDrawingMarkdown(document: DrawingDocument): string {
  const drawing = DrawingDocument.parse(document);
  return [
    `# ${drawing.title}`,
    "",
    "## Mechanical drawing",
    "",
    `Source schema: ${drawing.schema}`,
    `Source hash: \`${drawing.sourceHash}\``,
    `Units: ${drawing.units}`,
    "",
    "| View | Width (mm) | Height (mm) |",
    "| --- | ---: | ---: |",
    ...drawing.views.map(view => `| ${view.id} | ${view.widthMm} | ${view.heightMm} |`),
    "",
    "## Notes",
    "",
    ...drawing.notes.map(note => `- ${note}`),
    "",
  ].join("\n");
}

export function renderDrawingSvg(document: DrawingDocument): string {
  const drawing = DrawingDocument.parse(document);
  const margin = 40;
  const scale = 2;
  const gap = 80;
  const viewWidth = Math.max(...drawing.views.map(view => view.widthMm * scale));
  const viewHeight = Math.max(...drawing.views.map(view => view.heightMm * scale));
  const width = Math.ceil(margin * 2 + viewWidth * 3 + gap * 2);
  const height = Math.ceil(margin * 2 + viewHeight + 100);

  const viewMarkup = drawing.views.map((view, index) => {
    const x = margin + index * (viewWidth + gap) + (viewWidth - view.widthMm * scale) / 2;
    const y = margin + 40 + (viewHeight - view.heightMm * scale) / 2;
    const w = view.widthMm * scale;
    const h = view.heightMm * scale;
    return [
      `<g data-view="${view.id}">`,
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="black" stroke-width="2"/>`,
      `<text x="${x + w / 2}" y="${y + h + 24}" text-anchor="middle" font-family="sans-serif" font-size="14">${view.id.toUpperCase()}</text>`,
      `<text x="${x + w / 2}" y="${y - 10}" text-anchor="middle" font-family="sans-serif" font-size="11">${view.widthMm} mm</text>`,
      `<text x="${x - 8}" y="${y + h / 2}" text-anchor="end" dominant-baseline="middle" font-family="sans-serif" font-size="11">${view.heightMm} mm</text>`,
      "</g>",
    ].join("");
  }).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mechanical drawing for ${drawing.title}">`,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="white" stroke="black"/>`,
    `<text x="${margin}" y="24" font-family="sans-serif" font-size="16" font-weight="bold">${drawing.title}</text>`,
    viewMarkup,
    `<text x="${width - margin}" y="${height - 24}" text-anchor="end" font-family="sans-serif" font-size="11">AI Factory · ${drawing.sourceHash.slice(0, 12)}</text>`,
    "</svg>",
  ].join("");
}

export function canonicalDrawingDocument(document: DrawingDocument): string {
  const value = DrawingDocument.parse(document);
  return JSON.stringify({
    ...value,
    views: [...value.views].sort((a, b) => a.id.localeCompare(b.id)),
    notes: [...value.notes],
  });
}
