import { describe, expect, it } from "vitest";
import { casualResponse, isEngineeringRequest } from "../src/intent.js";

describe("request intent gate", () => {
  it("does not start engineering work for greetings", () => {
    expect(isEngineeringRequest("Hi")).toBe(false);
    expect(isEngineeringRequest("hello!")).toBe(false);
    expect(isEngineeringRequest("Good afternoon")).toBe(false);
  });

  it("keeps real engineering requests on the factory path", () => {
    expect(isEngineeringRequest("Create a 50 mm x 30 mm x 5 mm plate with a 10 mm hole")).toBe(true);
    expect(isEngineeringRequest("Make a small electronics enclosure")).toBe(true);
  });

  it("does not mistake a greeting prefix for a casual-only message", () => {
    expect(isEngineeringRequest("Hi, create a 20 mm cube")).toBe(true);
  });

  it("returns a useful conversational response", () => {
    expect(casualResponse("Hi")).toContain("Tell me what you'd like to build or change");
  });
});
