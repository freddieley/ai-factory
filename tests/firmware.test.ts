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

describe("board-specific AVR firmware target", () => {
  it("generates a real cross-compilation project for a known AVR board", () => {
    const project = generateFirmwareProject(architecture, { name: "avr-board", architecture: "avr-c", board: "atmega328p" });
    expect(project.target.toolchain).toBe("avr-gcc"); expect(project.files.map(file => file.path)).toEqual(["src/main.c", "README.md"]);
    expect(project.buildCommand).toEqual(["avr-gcc", "-mmcu=atmega328p", "-DF_CPU=16000000UL", "-Os", "-std=c11", "-Wall", "-Wextra", "-Werror", "src/main.c", "-o", "firmware.elf"]);
    expect(project.postBuildSteps).toHaveLength(2); expect(project.image).toEqual({ path: "firmware.hex", format: "ihex" });
  });
  it("rejects an unknown AVR board", () => { expect(() => generateFirmwareProject(architecture, { name: "avr-board", architecture: "avr-c", board: "not-a-real-board" })).toThrow(/Unknown AVR board/); });
  it("rejects a toolchain/architecture mismatch instead of silently ignoring it", () => {
    expect(() => generateFirmwareProject(architecture, { name: "avr-board", architecture: "avr-c", toolchain: "host-g++", board: "atmega328p" })).toThrow(/avr-c firmware targets require the avr-gcc toolchain/);
    expect(() => generateFirmwareProject(architecture, { name: "host-board", architecture: "portable-cpp", toolchain: "avr-gcc", board: "generic" })).toThrow(/portable-cpp firmware targets require the host-g\+\+ toolchain/);
  });
  it("refuses host HIL execution for a board-specific target", async () => {
    const project = generateFirmwareProject(architecture, { name: "avr-board", architecture: "avr-c", board: "atmega328p" });
    await expect(runFirmwareHil(project)).rejects.toThrow(/cannot be run here.*authorized hardware adapter/s);
  });
  it.skipIf(process.env.AVR_GCC_INTEGRATION !== "1")("cross-compiles a real Intel HEX image", async () => {
    const result = await buildFirmwareProject(generateFirmwareProject(architecture, { name: "avr-board", architecture: "avr-c", board: "atmega328p" }));
    expect(result.status).toBe("pass"); expect(result.exitCode).toBe(0); expect(result.postBuildSteps).toHaveLength(2); expect(result.postBuildSteps.every(step => step.exitCode === 0)).toBe(true);
    expect(result.image?.format).toBe("ihex"); expect(result.image?.content.startsWith(":")).toBe(true); expect(result.image?.sizeBytes).toBeGreaterThan(0);
  });
});

describe("board-specific STM32F405 firmware target", () => {
  it("generates a real bare-metal STM32F405 project", () => {
    const project = generateFirmwareProject(architecture, { name: "flight-controller", architecture: "arm-c", board: "stm32f405rg" });
    expect(project.target.toolchain).toBe("arm-none-eabi-gcc");
    expect(project.files.map(file => file.path)).toEqual(["src/main.c", "linker.ld", "README.md"]);
    expect(project.buildCommand).toContain("-mcpu=cortex-m4"); expect(project.buildCommand).toContain("-T"); expect(project.buildCommand).toContain("linker.ld");
    expect(project.postBuildSteps[0]).toEqual(["arm-none-eabi-objcopy", "-O", "ihex", "-R", ".note.gnu.build-id", "firmware.elf", "firmware.hex"]);
    expect(project.image).toEqual({ path: "firmware.hex", format: "ihex" });
    expect(project.files.find(file => file.path === "src/main.c")?.content).toContain("USART2_BASE");
  });
  it("rejects an unknown STM32 board", () => { expect(() => generateFirmwareProject(architecture, { name: "flight-controller", architecture: "arm-c", board: "not-a-real-board" })).toThrow(/Unknown ARM board/); });
  it.skipIf(process.env.ARM_GCC_INTEGRATION !== "1")("cross-compiles a real STM32F405 Intel HEX image", async () => {
    const result = await buildFirmwareProject(generateFirmwareProject(architecture, { name: "flight-controller", architecture: "arm-c", board: "stm32f405rg" }));
    expect(result.status).toBe("pass"); expect(result.exitCode).toBe(0); expect(result.postBuildSteps.every(step => step.exitCode === 0)).toBe(true);
    expect(result.image?.format).toBe("ihex"); expect(result.image?.content.startsWith(":")).toBe(true); expect(result.image?.sizeBytes).toBeGreaterThan(0);
  });
  it("does not pretend host HIL is physical STM32 execution", async () => {
    const project = generateFirmwareProject(architecture, { name: "flight-controller", architecture: "arm-c", board: "stm32f405rg" });
    await expect(runFirmwareHil(project)).rejects.toThrow(/cannot be run here.*authorized hardware adapter/s);
  });
});
