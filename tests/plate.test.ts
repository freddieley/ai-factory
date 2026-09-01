import { describe, expect, it } from "vitest";
import { createPlateWithHoleScript, parseCreatePlateArgs } from "../src/plate.js";

describe("plate capability",()=>{
  it("defaults omitted hole coordinates to the plate center",()=>{
    expect(parseCreatePlateArgs({widthMm:50,depthMm:30,heightMm:5,holeDiameterMm:10})).toMatchObject({holeXmm:25,holeYmm:15});
  });

  it("accepts an explicit centered hole without rejecting zero-valued coordinates in other dimensions",()=>{
    expect(parseCreatePlateArgs({widthMm:50,depthMm:30,heightMm:5,holeDiameterMm:10,holeXmm:25,holeYmm:15})).toMatchObject({holeXmm:25,holeYmm:15});
  });

  it("cuts the hole from an XY-plane sketch in the positive direction and verifies the cylindrical face",()=>{
    const script=createPlateWithHoleScript({widthMm:50,depthMm:30,heightMm:5,holeDiameterMm:10,holeXmm:25,holeYmm:15});
    expect(script).toContain("root.xYConstructionPlane");
    expect(script).toContain("adsk.fusion.FeatureOperations.CutFeatureOperation");
    expect(script).toContain("adsk.fusion.ExtentDirections.PositiveExtentDirection");
    expect(script).toContain("adsk.core.Cylinder.classType()");
    expect(script).toContain("through_hole=true");
  });
});
