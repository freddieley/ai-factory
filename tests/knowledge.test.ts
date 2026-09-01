import { describe, expect, it } from "vitest";
import { convertUnit, Unit, Material, Component, Standard, ManufacturingConstraint } from "../src/knowledge.js";

describe("engineering knowledge base",()=>{
  it("converts supported engineering units",()=>{
    expect(convertUnit(25.4,"mm","in")).toBeCloseTo(1,10);
    expect(convertUnit(180,"deg","rad")).toBeCloseTo(Math.PI,10);
  });
  it("rejects incompatible units",()=>expect(()=>convertUnit(1,"kg","mm")).toThrow("unsupported unit conversion"));
  it("validates knowledge records with provenance",()=>{
    const source={kind:"datasheet" as const,ref:"DS-001",confidence:0.95};
    expect(Material.parse({name:"Aluminium",grade:"6061-T6",densityKgM3:2700,sources:[source]}).grade).toBe("6061-T6");
    expect(Component.parse({partNumber:"MTR-1",name:"Motor",category:"actuator",sources:[source]}).lifecycle).toBe("unknown");
    expect(Standard.parse({code:"STD-1",title:"Example",source})).toHaveProperty("source.ref","DS-001");
    expect(ManufacturingConstraint.parse({process:"3d-print",minWallMm:0.8,source})).toHaveProperty("process","3d-print");
    expect(Unit.options).toContain("mm");
  });
});
