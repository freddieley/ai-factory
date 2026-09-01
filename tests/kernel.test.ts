import { describe, expect, it } from "vitest";
import { createProject, createRequirement, listRequirements, updateRequirementStatus, createArtifact, listArtifacts, linkArtifacts, listArtifactLinks } from "../src/db.js";

describe("factory kernel persistence", () => {
  it("persists requirements and lifecycle status", () => {
    const project = createProject("kernel-test", "test");
    const id = createRequirement(project!.id as string, "user", "width", "50", "mm");
    expect(listRequirements(project!.id as string)).toHaveLength(1);
    updateRequirementStatus(id, "verified");
    expect((listRequirements(project!.id as string)[0] as any).status).toBe("verified");
  });

  it("persists artifact lineage", () => {
    const project = createProject("artifact-test", "test");
    const a = createArtifact(project!.id as string, undefined, "cad", "design.step", "file:///design.step", "abc", { stage: "cad" });
    const b = createArtifact(project!.id as string, undefined, "verification", "cad-check.json", undefined, "def", { stage: "verification" });
    linkArtifacts(a, b, "verified-by");
    expect(listArtifacts(project!.id as string)).toHaveLength(2);
    expect(listArtifactLinks(project!.id as string)).toHaveLength(1);
  });
});
