import { describe, expect, it } from "vitest";
import { buildRequirementsDrivenElectronicsArchitecture } from "../src/electronics.js";

describe("requirements-driven electronics architecture", () => {
  it("derives power, functional blocks, and interfaces from electrical requirements", () => {
    const architecture = buildRequirementsDrivenElectronicsArchitecture([
      { id: "ER-1", description: "System input voltage", value: 12, unit: "V", priority: "must", verificationMethod: "measurement" },
      { id: "ER-2", description: "Controller shall provide MCU compute", priority: "must" },
      { id: "ER-3", description: "Drive motor actuator", priority: "must" },
      { id: "ER-4", description: "Provide IMU sensor", priority: "should" },
      { id: "ER-5", description: "Telemetry over CAN", priority: "should" },
    ], "robot controller");

    expect(architecture.schema).toBe("ai-factory.electronics-architecture/v1");
    expect(architecture.name).toBe("robot controller");
    expect(architecture.powerDomains).toEqual([{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["ER-1"] }]);
    expect(architecture.functionalBlocks.map(block => block.type)).toEqual(["power", "controller", "actuator", "sensor", "communications"]);
    expect(architecture.interfaces).toEqual([{ name: "CAN interface", protocol: "CAN", requirementIds: ["ER-5"] }]);
    expect(architecture.functionalBlocks.every(block => block.requirementIds.length > 0)).toBe(true);
  });

  it("does not invent a voltage rail when the requirements do not specify one", () => {
    const architecture = buildRequirementsDrivenElectronicsArchitecture([
      { id: "ER-POWER", description: "Limit input current", value: 8, unit: "A", priority: "must" },
    ]);
    expect(architecture.powerDomains).toEqual([]);
    expect(architecture.systemMaxCurrentA).toBe(8);
    expect(architecture.openQuestions.some(question => question.includes("input voltage"))).toBe(true);
  });

  it("extracts current limits embedded alongside a voltage requirement", () => {
    const architecture = buildRequirementsDrivenElectronicsArchitecture([
      { id: "ER-POWER", description: "12 V input, maximum 5 A", value: 12, unit: "V", priority: "must" },
    ]);
    expect(architecture.powerDomains).toEqual([{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["ER-POWER"] }]);
    expect(architecture.systemMaxCurrentA).toBe(5);
    expect(architecture.functionalBlocks.map(block => block.type)).toEqual(["power"]);
  });

  it("does not classify ordinary words containing engineering keywords as components", () => {
    const architecture = buildRequirementsDrivenElectronicsArchitecture([
      { id: "ER-1", description: "12 V input, maximum 5 A", value: 12, unit: "V" },
      { id: "ER-2", description: "maximum ambient temperature 40 C", priority: "must" },
    ]);
    expect(architecture.functionalBlocks.map(block => block.type)).toEqual(["power", "other"]);
  });

  it("keeps the result deterministic for the same requirement set", () => {
    const requirements = [
      { id: "B", description: "5 V sensor interface", value: 5, unit: "V" },
      { id: "A", description: "Motor actuator", value: "2", unit: "A" },
    ];
    expect(buildRequirementsDrivenElectronicsArchitecture(requirements)).toEqual(buildRequirementsDrivenElectronicsArchitecture(requirements));
  });
});
