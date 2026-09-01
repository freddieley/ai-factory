export type GeometryError = {
  code: string;
  message: string;
  parameter?: string;
  actual?: number;
  minimum?: number;
  maximum?: number;
};

export function positiveMm(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
  if (value > 10_000) throw new Error(`${name} exceeds the 10,000 mm safety limit.`);
  return value;
}

export function validatePlateHole(widthMm: number, depthMm: number, diameterMm: number): void {
  const radius = diameterMm / 2;
  if (diameterMm >= Math.min(widthMm, depthMm)) {
    const limit = Math.min(widthMm, depthMm);
    throw new Error(JSON.stringify({
      code: "INVALID_GEOMETRY",
      constraint: "HOLE_FITS_PLATE",
      message: "Through-hole diameter must be smaller than both plate dimensions.",
      parameter: "diameterMm",
      actual: diameterMm,
      maximum: Math.max(0, limit - 0.1)
    } satisfies GeometryError & { constraint: string }));
  }
  if (radius >= Math.min(widthMm, depthMm) / 2) {
    throw new Error("Hole leaves no material around the plate perimeter.");
  }
}
