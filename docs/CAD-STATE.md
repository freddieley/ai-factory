# CAD state and revision workflow

The mechanical factory keeps design intent in the vendor-neutral parametric model and treats CAD state as an immutable, hash-addressed history.

## Snapshot

`src/cad-state.ts` canonicalizes a validated parametric state and computes a SHA-256 content hash. A snapshot can be recorded as a `cad_snapshot` artifact, whose first artifact revision contains the exact snapshot payload.

## Diff

`diffCadStates` compares named dimensional parameters and feature definitions without invoking a CAD vendor. `diffCadRevisions` applies the same deterministic comparison to two persisted revisions. This gives the orchestration layer an explicit change summary before an adapter is allowed to execute a change.

## Revision

`appendArtifactRevision` appends a monotonically increasing immutable revision to an existing artifact. `appendCadSnapshot` uses that primitive for CAD-specific history. Revision payloads are hash-checked when replayed, so corrupted history is rejected rather than silently accepted.

## Restore, rollback, and replay

`restoreCadSnapshot` validates the original artifact snapshot and returns it as a rollback target. `replayCadHistory` validates every CAD snapshot revision in order and reconstructs the recorded state sequence deterministically.

`rollbackCadSnapshot(artifactId, targetRevision)` **does not mutate or delete history**. It appends a new immutable revision containing an exact canonical copy of the selected historical state and records which revision it rolled back to in the returned result. Consequently, rollback is itself auditable and replayable.

The control-plane rollback is deliberately separate from native CAD mutation. A future CAD adapter will consume the resulting state and perform an actual native-document rollback only through the existing capability, policy, and approval boundaries. The control plane never pretends that restoring JSON is equivalent to modifying a live CAD document.

## Invariants

- Snapshot hashes are deterministic for semantically identical canonical models.
- Historical revisions are immutable.
- Replay validates every stored content hash.
- Rollback creates a new revision rather than rewriting history.
- Invalid or out-of-range revision identifiers are rejected.
- CAD state operations do not manufacture anything or dispatch physical machine commands.

## Safety

Snapshot, diff, rollback, and replay operations are non-physical. Manufacturing, physical testing, and release remain behind the existing approval and policy boundary.
