import { describe, expect, it } from "vitest";
import { verificationSummary, verifyCadDimensions } from "../src/verification.js";

describe("deterministic engineering verification", () => {
  it("passes measured CAD dimensions within tolerance", () => {
    const result = verifyCadDimensions(
      { success: true, operation: "create_box", dimensionsMm: { width: 50.02, depth: 49.99, height: 10.01 } },
      { widthMm: 50, depthMm: 50, heightMm: 10 },
      0.05,
    );
    expect(result.status).toBe("pass");
    expect(result.checks).toHaveLength(3);
  });

  it("fails when physical evidence is outside tolerance", () => {
    const result = verifyCadDimensions(
      { success: true, operation: "create_box", dimensionsMm: { width: 51, depth: 50, height: 10 } },
      { widthMm: 50, depthMm: 50, heightMm: 10 },
      0.05,
    );
    expect(result.status).toBe("fail");
    expect(result.checks[0]?.status).toBe("fail");
  });

  it("blocks unverifiable CAD results", () => {
    const result = verifyCadDimensions({ success: true, operation: "create_box" }, { widthMm: 50, depthMm: 50, heightMm: 10 });
    expect(result.status).toBe("blocked");
    expect(verificationSummary(result)).toContain("BLOCKED");
  });
});
