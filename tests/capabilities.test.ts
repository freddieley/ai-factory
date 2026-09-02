import { describe, expect, it, vi } from "vitest";
import { capabilities, executeCapability, getCapability, listCapabilities, toOpenAITools } from "../src/capabilities.js";

vi.mock("../src/robot-cad-compiler.js", () => ({
  compileRobotDesignToFusion: vi.fn(async (design: { parts?: unknown[] }) => ({
    schema: "ai-factory.robot-cad-compile/v1",
    designHash: "a".repeat(64),
    success: true,
    document: "Test robot",
    createdParts: Array.from({ length: design.parts?.length ?? 0 }, (_, index) => `part-${index}`),
    unsupportedOperations: []
  }))
}));

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
    const cad = listCapabilities("cad"); expect(cad).toHaveLength(2);
    expect(cad.map(capability => capability.name)).toEqual(["ai_factory_inspect_fusion", "ai_factory_compile_robot_cad"]);
    expect(listCapabilities("mechanics").some(capability => capability.name === "ai_factory_submit_robot_design")).toBe(true);
    expect(listCapabilities("software")).toHaveLength(1); expect(listCapabilities("testing")).toHaveLength(2);
    expect(getCapability("ai_factory_submit_robot_design")?.domain).toBe("mechanics");
    expect(getCapability("ai_factory_create_box")?.discoverable).toBe(false);
    expect(getCapability("ai_factory_create_drone_reference")).toBeUndefined();
    expect(getCapability("ai_factory_inspect_fusion")?.domain).toBe("cad");
    expect(getCapability("ai_factory_plan_parametric_box")?.discoverable).toBe(false);
  });
  it("exposes the Fusion document inspection operation instead of the obsolete queryType wrapper", () => { const tool=getCapability("ai_factory_inspect_fusion"); expect(tool?.parameters).toMatchObject({ type:"object", properties:{ operation:{type:"string",enum:["search","open","recent"]} }, required:["operation"] }); });
  it("validates a model-authored robot design and immediately compiles it to CAD", async () => {
    const result=await executeCapability("ai_factory_submit_robot_design",{design:{schema:"ai-factory.robot-design/v1",name:"Test robot",mission:"Inspect a test fixture",requirements:[{id:"R1",description:"Carry payload",category:"functional",priority:"must"}],parts:[{id:"body",name:"Body",material:"aluminium",manufacturingProcess:"CNC",geometry:{schema:"ai-factory.robot-geometry/v1",units:"mm",operations:[{id:"s",op:"sketch",inputs:[],parameters:{plane:"XY"}},{id:"e",op:"extrude",inputs:["s"],parameters:{distanceMm:5}}],outputOperationId:"e"}}],joints:[],designRationale:[],unresolvedQuestions:[]}});
    expect(result).toMatchObject({schema:"ai-factory.robot-design-result/v1",design:{schema:"ai-factory.robot-design/v1"},designHash:expect.any(String),cad:{schema:"ai-factory.robot-cad-compile/v1",success:true}});
  });
  it("accepts a JSON-encoded robot design and still applies strict validation", async () => {
    const design={schema:"ai-factory.robot-design/v1",name:"String design",mission:"Validate JSON transport",requirements:[{id:"R1",description:"Have one part",category:"functional",priority:"must"}],parts:[{id:"body",name:"Body",material:"aluminium",manufacturingProcess:"CNC",geometry:{schema:"ai-factory.robot-geometry/v1",units:"mm",operations:[{id:"s",op:"sketch",inputs:[],parameters:{plane:"XY"}},{id:"e",op:"extrude",inputs:["s"],parameters:{distanceMm:5}}],outputOperationId:"e"}}],joints:[],designRationale:[],unresolvedQuestions:[]};
    const result=await executeCapability("ai_factory_submit_robot_design",{design:JSON.stringify(design)});
    expect(result).toMatchObject({schema:"ai-factory.robot-design-result/v1",design:{name:"String design"},cad:{success:true}});
  });
  it("rejects unknown capability execution before touching any external system", async () => { await expect(executeCapability("ai_factory_not_real", {})).rejects.toThrow("Unknown factory capability"); });
});
