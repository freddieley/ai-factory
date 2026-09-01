# Assembly Engineering Model

The factory's mechanical layer uses `ai-factory.mechanical-assembly/v1` as a vendor-neutral assembly contract.

## Scope

An assembly contains:

- **Parts**: stable IDs, names, references to parametric part models, optional material data, and parameter tolerances.
- **Joints**: explicit parent/child relationships with a constrained joint type and axes.
- **Fasteners**: standards, sizes, quantities, and the parts they join.

The representation deliberately does not depend on Fusion, STEP, or another CAD vendor. Vendor-specific adapters consume this model later.

## Validation invariants

1. Part, joint, and fastener identifiers are unique where applicable.
2. Every joint and fastener references existing parts.
3. A joint cannot connect a part to itself.
4. A referenced tolerance parameter must exist on the part's parametric model.
5. A tolerance may not permit a non-positive nominal dimension.
6. Canonical serialization sorts collections by stable identifiers, making hashes and revisions deterministic.

## Manufacturability checks

`checkAssemblyManufacturability` currently reports deterministic warnings for disconnected parts, zero-width tolerances, and unusually large fastener quantities. These are advisory findings; they are not yet a substitute for process-specific DFM analysis.

## Next expansion

The next mechanical work should add explicit datum/coordinate frames, joint limits, fit classes, material/process compatibility, minimum feature constraints, collision/clearance analysis, mass properties, and machine/process capability checks. Those checks should produce evidence-backed findings that can participate in the existing design-review and approval gates.
