# CAD state and revision workflow

The mechanical factory keeps design intent in the vendor-neutral parametric model and treats CAD state as an immutable, hash-addressed history.

## Snapshot

`src/cad-state.ts` canonicalizes a validated parametric state and computes a SHA-256 content hash. A snapshot can be recorded as a `cad_snapshot` artifact, whose first artifact revision contains the exact snapshot payload.

## Diff

`diffCadStates` compares named dimensional parameters and feature definitions without invoking a CAD vendor. This gives the orchestration layer a deterministic change summary before an adapter is allowed to execute a change.

## Revision

`appendArtifactRevision` appends a monotonically increasing immutable revision to an existing artifact. `appendCadSnapshot` uses that primitive for CAD-specific history.

## Restore and replay

`restoreCadSnapshot` verifies the stored hash before returning a snapshot suitable as a rollback target. `replayCadHistory` verifies every CAD snapshot revision in order, allowing a deterministic reconstruction of the recorded design history.

A future CAD adapter will consume these states to perform an actual native rollback. Until then, the control plane never pretends that restoring JSON is equivalent to modifying a live CAD document.

## Safety

Snapshot and diff operations do not manufacture anything and do not dispatch physical machine commands. Physical execution remains behind the existing approval and policy boundary.
