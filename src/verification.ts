export type VerificationStatus = "pass" | "fail" | "blocked";

export type NumericCheck = {
  name: string;
  expected: number;
  actual: number;
  tolerance: number;
  status: "pass" | "fail";
  delta: number;
};

export type CadVerification = {
  status: VerificationStatus;
  operation: string;
  checks: NumericCheck[];
  evidence: Record<string, unknown>;
  reason?: string;
};

export type CadMeasurement = {
  operation: string;
  dimensionsMm?: { width: number; depth: number; height: number };
  bodies?: number;
  document?: string;
  radiusMm?: number;
  success: boolean;
  error?: string;
};

function check(name: string, expected: number, actual: number, tolerance: number): NumericCheck {
  const delta = actual - expected;
  return { name, expected, actual, tolerance, delta, status: Math.abs(delta) <= tolerance ? "pass" : "fail" };
}

/**
 * Compare measured CAD geometry against the requested geometry. This is kept
 * deterministic and independent of the language model so the model cannot
 * declare a successful build without physical evidence from the CAD tool.
 */
export function verifyCadDimensions(
  measurement: CadMeasurement,
  expected: { widthMm: number; depthMm: number; heightMm: number },
  toleranceMm = 0.05,
): CadVerification {
  if (!measurement.success) {
    return {
      status: "blocked",
      operation: measurement.operation,
      checks: [],
      evidence: measurement,
      reason: measurement.error ?? "CAD operation did not report success.",
    };
  }

  if (!measurement.dimensionsMm) {
    return {
      status: "blocked",
      operation: measurement.operation,
      checks: [],
      evidence: measurement,
      reason: "CAD operation succeeded but supplied no measured dimensions.",
    };
  }

  const checks = [
    check("width_mm", expected.widthMm, measurement.dimensionsMm.width, toleranceMm),
    check("depth_mm", expected.depthMm, measurement.dimensionsMm.depth, toleranceMm),
    check("height_mm", expected.heightMm, measurement.dimensionsMm.height, toleranceMm),
  ];

  return {
    status: checks.every((item) => item.status === "pass") ? "pass" : "fail",
    operation: measurement.operation,
    checks,
    evidence: measurement,
  };
}

export function verificationSummary(result: CadVerification): string {
  const checks = result.checks.map((item) => `${item.name}=${item.status} (expected ${item.expected}, actual ${item.actual}, ±${item.tolerance})`).join("; ");
  return `${result.status.toUpperCase()}: ${result.operation}${checks ? ` — ${checks}` : ` — ${result.reason ?? "no checks"}`}`;
}
