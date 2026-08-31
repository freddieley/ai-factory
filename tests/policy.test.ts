import { describe, expect, it } from "vitest";
import { evaluateFusionOperation } from "../src/policy.js";

describe("Fusion execution policy", () => {
  it("allows read operations without approval", () => {
    const result = evaluateFusionOperation("fusion_mcp_read", { operation: "screenshot" });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.operationClass).toBe("read");
  });
  it("requires approval for physical manufacturing", () => {
    const result = evaluateFusionOperation("fusion_mcp_execute", { operation: "start CNC manufacturing job" });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.operationClass).toBe("manufacture");
  });
});
