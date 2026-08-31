import { describe, expect, it } from "vitest";

describe("AI Factory configuration", () => {
  it("has a local-first default model", () => {
    expect("qwen3.5:9b-q4_K_M").toContain("qwen3.5");
  });
});
