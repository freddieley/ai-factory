# Automated mechanical drawings

The drawing layer converts the canonical parametric mechanical model into a deterministic, vendor-neutral drawing document.

## Outputs

`buildDrawingDocument(model)` produces `ai-factory.mechanical-drawing/v1` with:

- a SHA-256 identity of the canonical source model;
- front, top, and right orthographic envelope views;
- resolved dimensions in millimetres;
- source-model notes and a manufacturing verification warning.

`renderDrawingMarkdown` produces a human-readable engineering document suitable for review and artifact storage.

`renderDrawingSvg` produces a deterministic SVG preview containing the three orthographic views, dimensions, title, and source identity.

## Engineering boundary

This is an automated documentation layer, not a substitute for a qualified drawing review. The current renderer intentionally exposes only dimensions that can be resolved directly from the canonical parametric model. It does not invent tolerances, datums, GD&T, hidden geometry, surface finish, material specifications, or manufacturing instructions that are absent from the source model.

The source hash makes the generated document traceable to an exact canonical model revision. Future drawing revisions should remain linked to that source identity through the artifact/revision system.
