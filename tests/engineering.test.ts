import { describe, expect, it } from "vitest";
import { EngineeringPlan, Requirement, classifyOperation } from "../src/engineering.js";

describe("engineering core", () => {
  it("creates requirements with safe defaults", () => {
    const req = Requirement.parse({ description: "Fit electronics tray", category: "mechanical", priority: "must" });
    expect(req.id).toMatch(/^REQ-/);
    expect(req.verificationStatus).toBe("unverified");
  });
  it("validates an engineering plan", () => {
    const plan = EngineeringPlan.parse({ objective: "Inspect a robot enclosure", steps: [{ id: "s1", title: "Inspect", description: "Read active design", operationClass: "read", requiresApproval: false }] });
    expect(plan.id).toMatch(/^PLAN-/);
    expect(plan.steps).toHaveLength(1);
  });
  it("classifies operations", () => {
    expect(classifyOperation("screenshot active document")).toBe("read");
    expect(classifyOperation("create and modify body")).toBe("modify");
    expect(classifyOperation("start CNC manufacturing job")).toBe("manufacture");
  });
});
