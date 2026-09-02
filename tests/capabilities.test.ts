import { describe, expect, it } from "vitest";
import { capabilities, executeCapability, getCapability, listCapabilities, toOpenAITools } from "../src/capabilities.js";

describe("factory capability registry", () => {
  it("keeps deterministic capabilities uniquely named and exposes OpenAI-compatible tools", () => {
    const names = capabilities.map(capability => capability.name);
    expect(new Set(names).size).toBe(names.length);

    const tools = toOpenAITools();
    expect(tools).toHaveLength(capabilities.length);
    expect(tools.map(tool => tool.type)).toEqual(names.map(() => "function"));
    expect(tools.map(tool => tool.function.name)).toEqual(names);
  });

  it("supports domain discovery without exposing non-CAD capabilities prematurely", () => {
    const cad = listCapabilities("cad");
    expect(cad).toHaveLength(6);
    expect(cad.every(capability => capability.name.startsWith("ai_factory_"))).toBe(true);
    expect(cad.length).toBeLessThan(capabilities.length);
    expect(listCapabilities("software")).toHaveLength(1);
    expect(getCapability("ai_factory_generate_firmware")?.domain).toBe("software");
    expect(getCapability("ai_factory_create_plate")?.domain).toBe("cad");
    expect(getCapability("ai_factory_inspect_fusion")?.domain).toBe("cad");
    expect(getCapability("ai_factory_plan_parametric_box")?.domain).toBe("mechanics");
  });

  it("exposes the Fusion document inspection operation instead of the obsolete queryType wrapper", () => {
    const tool=getCapability("ai_factory_inspect_fusion");
    expect(tool?.parameters).toMatchObject({
      type:"object",
      properties:{
        operation:{type:"string",enum:["search","open","recent"]}
      },
      required:["operation"]
    });
  });

  it("rejects unknown capability execution before touching any external system", async () => {
    await expect(executeCapability("ai_factory_not_real", {})).rejects.toThrow("Unknown factory capability");
  });
});
