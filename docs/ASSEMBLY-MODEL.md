# Assembly Engineering Model

The factory's mechanical layer uses `ai-factory.mechanical-assembly/v1` as a vendor-neutral assembly contract.

## Scope

An assembly contains:

- **Parts**: stable IDs, names, references to parametric part models, optional material data, manufacturing process, coordinate frame, and parameter tolerances.
- **Joints**: explicit parent/child relationships, constrained joint type/axes, and optional motion limits.
- **Fasteners**: standards, sizes, quantities, and the parts they join.
- **Process capabilities**: machine/process limits for tolerance, material, and maximum envelope size.

The representation deliberately does not depend on Fusion, STEP, or another CAD vendor. Vendor-specific adapters consume this model later.

## Validation invariants

1. Part, joint, and fastener identifiers are unique where applicable.
2. Every joint and fastener references existing parts.
3. A joint cannot connect a part to itself.
4. Coordinate-frame quaternions are normalized.
5. Joint limits have an explicit unit and a valid lower/upper range.
6. A referenced tolerance parameter must exist on the part's parametric model.
7. A tolerance may not permit a non-positive nominal dimension.
8. Canonical serialization sorts collections by stable identifiers, making hashes and revisions deterministic.

## Engineering calculations

`calculateAssemblyMassKg` calculates mass only when explicit material density and a supported box envelope are available. It intentionally returns `undefined` when the geometry or material data is insufficient rather than inventing precision.

## Manufacturability checks

`checkAssemblyManufacturability` produces deterministic findings for disconnected parts, zero-width tolerances, excessive fastener counts, zero-motion joints, process/material incompatibility, requested tolerances tighter than process capability, and parts exceeding a process's maximum envelope. These are baseline engineering checks, not a substitute for process-specific DFM analysis or physical inspection.

## Next expansion

The next mechanical work should add robust geometric transforms and collision/clearance analysis across arbitrary feature geometry, datum schemes and fit classes, richer material/process databases, and machine-specific capability evidence. Those checks should produce evidence-backed findings that participate in the existing design-review and approval gates.
