import { describe, expect, it } from "vitest";
import { createParametricBox } from "../src/parametric.js";
import { exploreDesignSpace } from "../src/design-space.js";

describe("constrained design-space exploration", () => {
  const model = createParametricBox("bracket", 20, 30, 10);

  it("enumerates deterministic candidates and ranks the objective", () => {
    const input = {
      variables: [
        { parameter: "width", minMm: 10, maxMm: 20, stepMm: 5 },
        { parameter: "height", minMm: 5, maxMm: 10, stepMm: 5 },
      ],
      objective: { parameter: "width", direction: "minimize" },
    };
    const first = exploreDesignSpace(model, input);
    const second = exploreDesignSpace(model, input);
    expect(first).toEqual(second);
    expect(first.map(candidate => candidate.objectiveValueMm)).toEqual([10, 10, 15, 15, 20, 20]);
    expect(first.map(candidate => candidate.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(first.map(candidate => candidate.hash)).size).toBe(first.length);
  });

  it("applies constraints before ranking", () => {
    const candidates = exploreDesignSpace(model, {
      variables: [{ parameter: "width", minMm: 10, maxMm: 20, stepMm: 5 }],
      constraints: [{ id: "minimum-width", parameter: "width", minMm: 15 }],
      objective: { parameter: "width", direction: "minimize" },
    });
    expect(candidates.map(candidate => candidate.objectiveValueMm)).toEqual([15, 20]);
  });

  it("rejects unknown parameters, duplicate variables, and oversized spaces", () => {
    expect(() => exploreDesignSpace(model, { variables: [{ parameter: "missing", minMm: 1, maxMm: 2, stepMm: 1 }], objective: { parameter: "width", direction: "minimize" } })).toThrow(/Unknown design variable/);
    expect(() => exploreDesignSpace(model, { variables: [{ parameter: "width", minMm: 1, maxMm: 2, stepMm: 1 }, { parameter: "width", minMm: 1, maxMm: 2, stepMm: 1 }], objective: { parameter: "width", direction: "minimize" } })).toThrow(/Duplicate/);
    expect(() => exploreDesignSpace(model, { variables: [{ parameter: "width", minMm: 1, maxMm: 10_000, stepMm: 1 }, { parameter: "height", minMm: 1, maxMm: 10_000, stepMm: 1 }], objective: { parameter: "width", direction: "minimize" }, maxCandidates: 100 })).toThrow(/exceeding maxCandidates/);
  });
});
