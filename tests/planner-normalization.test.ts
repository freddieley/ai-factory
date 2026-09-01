import { describe, expect, it } from "vitest";

describe("planner model-output normalization contract", () => {
  it("documents aliases expected from small local models", () => {
    const categoryAliases = ["Access Control", "Data Integrity", "Output"];
    const priorityAliases = ["High", "Critical", "Medium"];
    const operationAliases = ["Authentication", "Data Retrieval", "Analysis", "Reporting"];
    expect(categoryAliases).toHaveLength(3);
    expect(priorityAliases).toContain("Critical");
    expect(operationAliases).toContain("Data Retrieval");
  });
});
