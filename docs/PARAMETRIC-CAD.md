# Parametric CAD contract

The factory's mechanical design representation is intentionally independent of Autodesk Fusion or any other CAD vendor.

## Contract

`src/parametric.ts` defines `ai-factory.parametric-mechanical/v1` with:

- a canonical millimetre unit system;
- named positive dimensional parameters;
- vendor-neutral mechanical feature types;
- parameter references or explicit positive literals;
- deterministic validation of referenced dimensions;
- a canonical JSON representation suitable for hashing and artifact storage.

A CAD adapter consumes this representation and translates it into native features. The adapter must not become the source of truth for design intent.

## Why this matters

The same design definition can later target Fusion, FreeCAD, OpenSCAD, another CAD kernel, a geometry service, or a simulation representation without asking the language model to regenerate vendor-specific geometry.

The next Phase 2 item extends this foundation with snapshots, diffs, revision identity, rollback, and deterministic replay.

## Safety invariant

Parametric dimensions are validated before adapter execution. The current generic safety ceiling is 10,000 mm for a single dimensional value, matching the bounded CAD executor. This is a validation boundary, not a substitute for product-specific engineering limits.
