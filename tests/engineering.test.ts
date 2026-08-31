import { describe, expect, it } from "vitest";
import { EngineeringPlan, Requirement } from "../src/engineering.js";
describe("engineering schemas",()=>{
 it("creates a requirement with safe defaults",()=>{const r=Requirement.parse({description:"Base must fit the electronics tray",category:"mechanical",priority:"must"});expect(r.id).toMatch(/^REQ-/);expect(r.verificationStatus).toBe("unverified");});
 it("validates an engineering plan",()=>{const p=EngineeringPlan.parse({objective:"Create an electronics enclosure",assumptions:["Metric units"],steps:[{id:"step-1",title:"Inspect",description:"Inspect the active design",operationClass:"read",requiresApproval:false}]});expect(p.id).toMatch(/^PLAN-/);expect(p.steps).toHaveLength(1);});
});
