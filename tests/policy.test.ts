import { describe, expect, it } from "vitest";
import { evaluateFusionOperation } from "../src/policy.js";
describe("Fusion operation policy",()=>{
 it("allows inspection without approval",()=>{const r=evaluateFusionOperation("fusion_mcp_read",{queryType:"document",operation:"recent"});expect(r.allowed).toBe(true);expect(r.requiresApproval).toBe(false);expect(r.operationClass).toBe("read");});
 it("requires approval for physical manufacturing",()=>{const r=evaluateFusionOperation("fusion_mcp_execute",{operation:"start CNC manufacturing job"});expect(r.allowed).toBe(true);expect(r.requiresApproval).toBe(true);expect(r.operationClass).toBe("manufacture");});
 it("allows model-authored CAD compilation even when design metadata names manufacturing processes",()=>{const r=evaluateFusionOperation("ai_factory_compile_robot_cad",{design:{parts:[{manufacturingProcess:"cnc_machining"}]}});expect(r.allowed).toBe(true);expect(r.requiresApproval).toBe(false);expect(r.operationClass).toBe("modify");});
});
