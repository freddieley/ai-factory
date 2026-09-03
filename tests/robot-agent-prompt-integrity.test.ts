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

  it("describes the generic model/compiler boundary and feature orientation", () => {
    expect(source).toContain("interpret the user's requirements, dimensions, constraints, relationships");
    expect(source).toContain("The deterministic factory supports only the operation vocabulary exposed by the schema");
    expect(source).toContain("Do not use task-specific templates, benchmark examples, memorized dimensions, or precomputed placements.");
    expect(source).toContain("Operation inputs are ALWAYS operation ID strings; never inline nested operation objects.");
    expect(source).toContain("Executable CAD operations in the current factory are: sketch, rectangle, circle, extrude, and transform.");
    expect(source).toContain("For a simple solid made from a planar profile, prefer the explicit graph sketch -> rectangle/circle -> extrude.");
    expect(source).toContain("For subtractive holes in an existing extrusion, use the generic circle-on-extrude cut semantics with an explicit plane and throughAll/extent.");
    expect(source).toContain("A sketch plane is a real geometric reference, not metadata.");
    expect(source).toContain("A shaft running along the assembly Y direction needs an XZ circular cut, not an XY circular cut.");
    expect(source).toContain("The deterministic factory owns CAD API mechanics");
  });

  it("keeps retries grounded in deterministic rejection evidence without adding task-specific geometry", () => {
    expect(source).toContain("fix the exact evidenced failure");
    expect(source).toContain("use only executable operations sketch, rectangle, circle, extrude, and transform");
    expect(source).toContain("never embed an operation object inside inputs or parameters");
    expect(source).toContain("ensure every repeated part has a genuinely distinct authored placement");
    expect(source).toContain("for every circular cut from an extrude explicitly choose plane XY/XZ/YZ from the required physical axis");
    expect(source).toContain("Do not use benchmark-specific examples, hardcoded dimensions, hardcoded placements, templates, or task-specific workarounds.");
  });
});
