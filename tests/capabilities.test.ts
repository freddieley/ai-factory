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
    expect(listCapabilities("cad")).toHaveLength(5);
    expect(listCapabilities("cad").length).toBeLessThan(capabilities.length);
    expect(listCapabilities("software")).toHaveLength(0);
    expect(getCapability("ai_factory_create_plate")?.domain).toBe("cad");
    expect(getCapability("ai_factory_plan_parametric_box")?.domain).toBe("mechanics");
  });

  it("rejects unknown capability execution before touching any external system", async () => {
    await expect(executeCapability("ai_factory_not_real", {})).rejects.toThrow("Unknown factory capability");
  });
});
