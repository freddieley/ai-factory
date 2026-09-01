import { beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../src/db.js";
import { canStartStage, nextStage } from "../src/lifecycle.js";
import { initializeProjectStages, listProjectStages, transitionProjectStage } from "../src/lifecycle-db.js";

describe("factory lifecycle", () => {
  it("orders stages and starts only after the previous stage passes", () => {
    const stages = [
      { name: "requirements" as const, order: 10, status: "passed" as const },
      { name: "planning" as const, order: 20, status: "pending" as const },
      { name: "design" as const, order: 30, status: "pending" as const }
    ];

    expect(nextStage(stages)).toBe("planning");
    expect(canStartStage(stages[1], stages[0], false, false)).toBe(true);
    expect(canStartStage(stages[2], stages[1], false, false)).toBe(false);
  });

  it("requires explicit approval for manufacturing stages", () => {
    const stage = { name: "manufacturing" as const, status: "ready" as const };
    const previous = { status: "passed" as const };
    expect(canStartStage(stage, previous, true, false)).toBe(false);
    expect(canStartStage(stage, previous, true, true)).toBe(true);
  });

  it("persists attempts and terminal lifecycle state", () => {
    const project = createProject("Lifecycle Test", "test");
    initializeProjectStages(project.id);

    const started = transitionProjectStage(project.id, "requirements", "running", { runId: "run-1" });
    expect(started?.attempt).toBe(1);
    expect(started?.status).toBe("running");

    const passed = transitionProjectStage(project.id, "requirements", "passed");
    expect(passed?.status).toBe("passed");
    expect(passed?.completed_at).toBeTruthy();
    expect(listProjectStages(project.id)).toHaveLength(9);
  });
});
