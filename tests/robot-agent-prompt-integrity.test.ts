import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("robot agent prompt integrity", () => {
  const source = readFileSync(resolve(process.cwd(), "src/robot-agent.ts"), "utf8");

  it("does not contain benchmark-specific geometry answers", () => {
    expect(source).not.toContain("100 mm x 60 mm plate");
    expect(source).not.toContain("6 mm diameter holes 10 mm from each corner");
    expect(source).not.toContain("(-40,-20)");
    expect(source).not.toContain("(40,-20)");
    expect(source).not.toContain("(-40,20)");
    expect(source).not.toContain("(40,20)");
    expect(source).not.toContain("20 mm x 20 mm block centered on the left or right edge");
  });

  it("still describes generic model responsibilities and deterministic verification boundaries", () => {
    expect(source).toContain("interpret the user's requirements, dimensions, constraints, relationships");
    expect(source).toContain("The deterministic factory supports only the operation vocabulary exposed by the schema");
    expect(source).toContain("The factory owns CAD API mechanics");
    expect(source).toContain("Do not use task-specific templates, benchmark examples, memorized dimensions, or precomputed placements.");
  });
});
