import { describe, expect, it } from "vitest";
import { ExecutionController } from "../src/execution.js";

describe("ExecutionController", () => {
  it("enforces model and tool budgets", () => {
    const c = new ExecutionController({ maxModelCalls: 1, maxToolCalls: 2, maxWallMs: 60_000 });
    expect(c.canModelCall()).toBe(true);
    c.recordModelCall();
    expect(c.canModelCall()).toBe(false);
    c.recordToolCall();
    c.recordToolCall();
    expect(c.canToolCall()).toBe(false);
  });

  it("blocks repeated tool fingerprints", () => {
    const c = new ExecutionController({ maxModelCalls: 4, maxToolCalls: 30, maxWallMs: 60_000 });
    expect(c.isRepeated("fusion_mcp_read", { operation: "activeDocument" })).toBe(false);
    expect(c.isRepeated("fusion_mcp_read", { operation: "activeDocument" })).toBe(true);
    expect(c.isRepeated("fusion_mcp_read", { operation: "projects" })).toBe(false);
  });
});
