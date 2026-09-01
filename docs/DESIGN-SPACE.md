# Constrained design-space exploration

Phase 2 now includes a deterministic search primitive for bounded parametric mechanical designs.

## Model

`DesignVariable` selects an existing metric model parameter and defines an inclusive minimum, maximum, and step. `DesignConstraint` applies independent lower/upper bounds to existing parameters. `DesignObjective` selects one existing parameter for deterministic minimization or maximization.

`exploreDesignSpace()` validates the source parametric model, rejects unknown or duplicate variables, bounds the Cartesian candidate count with `maxCandidates`, evaluates every candidate, filters constraints, and ranks the survivors by the declared objective.

Each candidate carries the validated parametric model, objective value, deterministic rank, and SHA-256 hash of its canonical serialization.

## Determinism and safety

Candidate enumeration is bounded before traversal. Parameter values are rounded to 12 decimal places to avoid accumulating floating-point step noise. Objective ties are resolved by canonical model hash, making ordering reproducible across runs.

The search is intentionally exhaustive and bounded rather than probabilistic. It does not claim physical performance, manufacturing feasibility, structural safety, or optimality outside the declared parameter space. Downstream engineering checks must still validate candidates.

## Example

```ts
const candidates = exploreDesignSpace(model, {
  variables: [{ parameter: "width", minMm: 10, maxMm: 30, stepMm: 2 }],
  constraints: [{ id: "minimum-width", parameter: "width", minMm: 14 }],
  objective: { parameter: "width", direction: "minimize" },
});
```

The first candidate is the best result under the declared objective and constraints; it is not automatically an approved design.
