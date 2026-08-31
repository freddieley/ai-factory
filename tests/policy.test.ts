import { describe, expect, it } from "vitest";
import { evaluateFusionOperation } from "../src/policy.js";
describe("Fusion operation policy",()=>{
 it("allows inspection without approval",()=>{const r=evaluateFusionOperation("fusion_mcp_read",{operation:"screenshot"});expect(r.allowed).toBe(true);expect(r.requiresApproval).toBe(false);expect(r.operationClass).toBe("read");});
 it("requires approval for physical manufacturing",()=>{const r=evaluateFusionOperation("fusion_mcp_execute",{operation:"start CNC manufacturing job"});expect(r.allowed).toBe(true);expect(r.requiresApproval).toBe(true);expect(r.operationClass).toBe("manufacture");});
});
