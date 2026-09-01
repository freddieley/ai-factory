# Advanced mechanical constraints

Phase 2 extends the vendor-neutral assembly model with a deterministic constraint layer in `src/mechanical-constraints.ts`.

## Datums

`DatumReference` represents a primary, secondary, or tertiary datum frame with an origin, normal, local X direction, and positional tolerance. Frames are normalized and require perpendicular normal/X directions. A scheme may contain one, two, or three contiguous roles beginning at primary; duplicate roles and degenerate frames are rejected.

`transformDatum` applies an existing rigid transform to both the datum origin and its direction vectors, preserving direction normalization rather than treating directions as translated points.

## Fits

`FitSpec` models a hole/shaft fit using nominal diameters and independent bilateral tolerances. `analyzeFit` computes nominal, worst-case minimum, and worst-case maximum diametral clearance. Clearance, transition, and interference classifications are checked deterministically, including optional required clearance bounds.

## Materials and machines

`MaterialRecord` adds optional grade, density, strength, hardness, service-temperature, supported-process, and evidence identifiers to the simpler assembly material representation.

`MachineCapability` makes process capability machine-specific and records material support, part envelope, minimum feature size, achievable tolerance, axis travel, and the evidence identifiers supporting the capability claim. Findings carry those evidence identifiers so later review gates can trace the engineering decision back to its source.

## Safety and determinism

The analysis is non-physical. It performs validation and calculation only; it does not dispatch manufacturing or machine commands. Findings are sorted deterministically. Missing geometry is not replaced with guessed dimensions.

The module is intentionally additive to the existing assembly contract so vendor-specific CAD adapters remain downstream consumers rather than becoming the source of engineering truth.
