import { describe, expect, it } from "vitest";
import { capabilities, executeCapability, getCapability, listCapabilities, toOpenAITools } from "../src/capabilities.js";

describe("factory capability registry", () => {
  it("keeps deterministic capabilities uniquely named and exposes only discoverable tools", () => {
    const names = capabilities.map(capability => capability.name); expect(new Set(names).size).toBe(names.length);
    const tools = toOpenAITools(); const discoverable = capabilities.filter(capability => capability.discoverable !== false);
    expect(tools).toHaveLength(discoverable.length); expect(tools.map(tool => tool.type)).toEqual(discoverable.map(() => "function")); expect(tools.map(tool => tool.function.name)).toEqual(discoverable.map(capability => capability.name));
    expect(tools.some(tool => tool.function.name === "ai_factory_submit_robot_design")).toBe(true);
    expect(tools.some(tool => tool.function.name === "ai_factory_create_box")).toBe(false);
    expect(tools.some(tool => tool.function.name === "ai_factory_create_mounting_plate")).toBe(false);
  });
  it("supports domain discovery while hiding legacy CAD primitives", () => {
    const cad = listCapabilities("cad"); expect(cad).toHaveLength(1); expect(cad[0].name).toBe("ai_factory_inspect_fusion");
    expect(listCapabilities("mechanics").some(capability => capability.name === "ai_factory_submit_robot_design")).toBe(true);
    expect(listCapabilities("software")).toHaveLength(1); expect(listCapabilities("testing")).toHaveLength(2);
    expect(getCapability("ai_factory_submit_robot_design")?.domain).toBe("mechanics");
    expect(getCapability("ai_factory_create_box")?.discoverable).toBe(false);
    expect(getCapability("ai_factory_create_drone_reference")).toBeUndefined();
    expect(getCapability("ai_factory_inspect_fusion")?.domain).toBe("cad");
    expect(getCapability("ai_factory_plan_parametric_box")?.discoverable).toBe(false);
  });
  it("exposes the Fusion document inspection operation instead of the obsolete queryType wrapper", () => { const tool=getCapability("ai_factory_inspect_fusion"); expect(tool?.parameters).toMatchObject({ type:"object", properties:{ operation:{type:"string",enum:["search","open","recent"]} }, required:["operation"] }); });
  it("executes validation of a model-authored robot design without selecting a template", async () => {
    const result=await executeCapability("ai_factory_submit_robot_design",{design:{schema:"ai-factory.robot-design/v1",name:"Test robot",mission:"Inspect a test fixture",requirements:[{id:"R1",description:"Carry payload",category:"functional",priority:"must"}],parts:[{id:"body",name:"Body",material:"aluminium",manufacturingProcess:"CNC",geometry:{schema:"ai-factory.robot-geometry/v1",units:"mm",operations:[{id:"s",op:"sketch",inputs:[],parameters:{plane:"XY"}},{id:"e",op:"extrude",inputs:["s"],parameters:{distanceMm:5}}],outputOperationId:"e"}}],joints:[],designRationale:[],unresolvedQuestions:[]}});
    expect(result).toMatchObject({schema:"ai-factory.robot-design-result/v1",design:{schema:"ai-factory.robot-design/v1"},designHash:expect.any(String)});
  });
  it("rejects unknown capability execution before touching any external system", async () => { await expect(executeCapability("ai_factory_not_real", {})).rejects.toThrow("Unknown factory capability"); });
});
