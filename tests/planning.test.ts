import { describe, expect, it } from "vitest";
import { buildPlanningPrompt, parseEngineeringPlan } from "../src/planning.js";

describe("engineering planner", () => {
  it("parses plain JSON into a validated engineering plan", () => {
    const plan = parseEngineeringPlan(JSON.stringify({
      objective: "Create a mounting plate",
      assumptions: [],
      requirements: [{ description: "Plate is 50 mm wide", category: "mechanical", value: 50, unit: "mm", priority: "must", verificationMethod: "measure CAD bounding box" }],
      steps: [{ id: "STEP-1", title: "Inspect", description: "Inspect the active design", operationClass: "read", requiresApproval: false }],
      expectedVerification: ["Measured dimensions"]
    }));
    expect(plan.objective).toBe("Create a mounting plate");
    expect(plan.requirements[0]?.verificationStatus).toBe("unverified");
    expect(plan.steps[0]?.operationClass).toBe("read");
  });

  it("parses fenced JSON and preserves approval requirements", () => {
    const plan = parseEngineeringPlan("```json\n" + JSON.stringify({
      objective: "Manufacture a bracket",
      steps: [{ id: "STEP-1", title: "Manufacture", description: "Prepare the approved job", operationClass: "manufacture", requiresApproval: true }]
    }) + "\n```");
    expect(plan.steps[0]?.requiresApproval).toBe(true);
    expect(plan.steps[0]?.operationClass).toBe("manufacture");
  });

  it("puts constraints directly into the planner prompt", () => {
    const prompt = buildPlanningPrompt("Make a robot enclosure", ["Keep it under 100 mm", "Do not manufacture"]);
    expect(prompt).toContain("Keep it under 100 mm");
    expect(prompt).toContain("Do not manufacture");
    expect(prompt).toContain("Return ONLY valid JSON");
  });
});
