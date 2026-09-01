import { describe, expect, it } from "vitest";
import { createProject } from "../src/db.js";
import { appendCadSnapshot, diffCadStates, recordCadSnapshot, replayCadHistory, restoreCadSnapshot, snapshotCadState } from "../src/cad-state.js";
import { createParametricBox } from "../src/parametric.js";

describe("CAD state snapshots", () => {
  const base = { model: createParametricBox("plate", 50, 40, 5) };

  it("hashes canonical state deterministically", () => {
    const first = snapshotCadState(base);
    const second = snapshotCadState({ model: { ...base.model, parameters: [...base.model.parameters].reverse() } });
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.schema).toBe("ai-factory.cad-snapshot/v1");
  });

  it("reports parameter and feature changes", () => {
    const changed = { model: createParametricBox("plate", 55, 40, 5) };
    const diff = diffCadStates(base, changed);
    expect(diff.changed).toBe(true);
    expect(diff.changedParameters).toEqual([{ name: "width", before: 50, after: 55 }]);
  });

  it("reports identical states as unchanged", () => {
    const diff = diffCadStates(base, snapshotCadState(base).state);
    expect(diff.changed).toBe(false);
    expect(diff.changedParameters).toHaveLength(0);
    expect(diff.changedFeatures).toHaveLength(0);
  });

  it("persists, restores, and replays immutable snapshot revisions", () => {
    const project = createProject("cad-state-test", "snapshot persistence");
    const first = recordCadSnapshot(project!.id, base);
    const secondState = { model: createParametricBox("plate", 55, 40, 5) };
    const second = appendCadSnapshot(first.artifactId, secondState);
    expect(second.revision).toBe(2);
    expect(restoreCadSnapshot(first.artifactId).contentHash).toBe(first.contentHash);
    const history = replayCadHistory(first.artifactId);
    expect(history).toHaveLength(2);
    expect(history[1]?.contentHash).toBe(second.contentHash);
  });
});
