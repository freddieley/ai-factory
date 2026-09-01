import { describe, expect, it, vi } from "vitest";
import { requestModel } from "../src/model.js";

describe("model request layer", () => {
  it("retries a transient timeout once and then succeeds", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("Model request timed out after 45000ms"))
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "ok" } }] });
    const onRetry = vi.fn();

    const result = await requestModel({
      client: { chat: { completions: { create } } } as never,
      model: "local-test",
      temperature: 0,
      messages: [{ role: "user", content: "test" }],
      tools: [],
      timeoutMs: 50,
      retries: 1,
      onRetry
    });

    expect(result.choices[0]?.message.content).toBe("ok");
    expect(create).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-transient model errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("invalid_request_error"));

    await expect(requestModel({
      client: { chat: { completions: { create } } } as never,
      model: "local-test",
      temperature: 0,
      messages: [{ role: "user", content: "test" }],
      tools: [],
      timeoutMs: 50,
      retries: 2
    })).rejects.toThrow("invalid_request_error");

    expect(create).toHaveBeenCalledTimes(1);
  });
});
