import { describe, expect, it } from "vitest";
import { buildFirmwareProject, generateFirmwareProject } from "../src/firmware.js";
import { parseFirmwareTelemetry, planFirmwareFlash, runFirmwareHil } from "../src/firmware-io.js";

const architecture = {
  schema: "ai-factory.electronics-architecture/v1", name: "controller board",
  requirements: [
    { id: "R1", description: "12 V input, maximum 5 A", value: 12, unit: "V", priority: "must" },
    { id: "R2", description: "microcontroller at 2 MHz", value: 2, unit: "MHz", priority: "must" },
    { id: "R3", description: "CAN at 1 MHz", value: 1, unit: "MHz", priority: "must" },
  ], powerDomains: [{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["R1"] }], systemMaxCurrentA: 5,
  functionalBlocks: [{ id: "block-controller", type: "controller", name: "Control and compute", requirementIds: ["R2"] }],
  interfaces: [{ name: "CAN interface", protocol: "CAN", requirementIds: ["R3"] }], openQuestions: [],
};

describe("firmware generation", () => {
  it("produces a validated portable project with architecture lineage", () => {
    const project = generateFirmwareProject(architecture, { name: "test-board", architecture: "portable-cpp", board: "generic" });
    expect(project.schema).toBe("ai-factory.firmware-project/v1"); expect(project.architectureHash).toHaveLength(64);
    expect(project.files.map(file => file.path)).toEqual(["src/main.cpp", "README.md"]); expect(project.interfaces).toEqual(["CAN"]);
  });
  it("builds the generated source with the real host compiler", async () => {
    const project = generateFirmwareProject(architecture, { name: "test-board", architecture: "portable-cpp", board: "generic" });
    const result = await buildFirmwareProject(project); expect(result.status).toBe("pass"); expect(result.exitCode).toBe(0);
  });
  it("parses structured heartbeat telemetry", () => {
    expect(parseFirmwareTelemetry("AI_FACTORY_HEARTBEAT 7")).toMatchObject({ schema: "ai-factory.firmware-telemetry/v1", type: "heartbeat", sequence: 7 }); expect(parseFirmwareTelemetry("unrelated output")).toBeNull();
  });
  it("executes the generated firmware through the host HIL interface", async () => {
    const project = generateFirmwareProject(architecture, { name: "test-board", architecture: "portable-cpp", board: "generic" });
    const result = await runFirmwareHil(project); expect(result.status).toBe("pass"); expect(result.events[0]?.sequence).toBe(1);
  });
  it("plans physical flashing without executing hardware writes", () => {
    const plan = planFirmwareFlash({ tool: "dfu-util", artifactPath: "firmware.bin", device: "0483:df11" });
    expect(plan.schema).toBe("ai-factory.firmware-flash-plan/v1"); expect(plan.command).toEqual(["dfu-util", "-d", "0483:df11", "-D", "firmware.bin"]); expect(plan.requiresExplicitExecution).toBe(true);
    expect(() => planFirmwareFlash({ tool: "dfu-util", artifactPath: "firmware.bin", device: "0483:df11", execute: true })).toThrow("authorized hardware execution adapter");
  });
  it("is deterministic", () => {
    const target = { name: "test-board", architecture: "portable-cpp", board: "generic" } as const;
    expect(generateFirmwareProject(architecture, target)).toEqual(generateFirmwareProject(architecture, target));
  });
});
