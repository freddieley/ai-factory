import { describe, expect, it } from "vitest";
import { createParametricBox } from "../src/parametric.js";
import { diffCadStates, snapshotCadState } from "../src/cad-state.js";

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
});
