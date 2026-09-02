import { describe, expect, it } from "vitest";
import { generateFirmwareProject } from "../src/firmware.js";

const architecture = {
  schema: "ai-factory.electronics-architecture/v1",
  name: "controller board",
  requirements: [
    { id: "R1", description: "12 V input, maximum 5 A", value: 12, unit: "V", priority: "must" },
    { id: "R2", description: "microcontroller at 2 MHz", value: 2, unit: "MHz", priority: "must" },
    { id: "R3", description: "CAN at 1 MHz", value: 1, unit: "MHz", priority: "must" },
  ],
  powerDomains: [{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["R1"] }],
  systemMaxCurrentA: 5,
  functionalBlocks: [{ id: "block-controller", type: "controller", name: "Control and compute", requirementIds: ["R2"] }],
  interfaces: [{ name: "CAN interface", protocol: "CAN", requirementIds: ["R3"] }],
  openQuestions: [],
};

describe("firmware generation", () => {
  it("produces a validated portable project with architecture lineage", () => {
    const project = generateFirmwareProject(architecture, { name: "test-board", architecture: "portable-cpp", board: "generic" });
    expect(project.schema).toBe("ai-factory.firmware-project/v1");
    expect(project.architectureHash).toHaveLength(64);
    expect(project.files.map(file => file.path)).toEqual(["src/main.cpp", "README.md"]);
    expect(project.interfaces).toEqual(["CAN"]);
    expect(project.buildCommand.slice(0, 3)).toEqual(["g++", "-std=c++17", "-Wall"]);
  });

  it("is deterministic", () => {
    const target = { name: "test-board", architecture: "portable-cpp", board: "generic" } as const;
    expect(generateFirmwareProject(architecture, target)).toEqual(generateFirmwareProject(architecture, target));
  });
});
