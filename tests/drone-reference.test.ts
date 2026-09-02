import { describe, expect, it } from "vitest";
import { createDroneReferenceElectronicsArchitecture, createDroneReferenceSpecification } from "../src/drone-reference.js";

describe("drone reference platform", () => {
  it("defines a concrete benign quadrotor flight-controller specification", () => {
    const specification = createDroneReferenceSpecification();
    expect(specification.schema).toBe("ai-factory.drone-reference/v1");
    expect(specification.mission).toBe("benign-electric-quadrotor-research-platform");
    expect(specification.requirements.map(requirement => requirement.id)).toContain("DRONE-IMU-001");
    expect(specification.requirements.map(requirement => requirement.id)).toContain("DRONE-ESC-001");
  });

  it("derives the electronics architecture from the same requirements", () => {
    const architecture = createDroneReferenceElectronicsArchitecture();
    expect(architecture.powerDomains.map(domain => domain.nominalVoltageV)).toEqual([3.3, 5, 14.8]);
    expect(architecture.systemMaxCurrentA).toBe(2);
    expect(architecture.functionalBlocks.some(block => block.type === "controller")).toBe(true);
    expect(architecture.functionalBlocks.some(block => block.type === "sensor")).toBe(true);
    expect(architecture.functionalBlocks.some(block => block.type === "actuator")).toBe(true);
    expect(architecture.interfaces.map(iface => iface.protocol)).toEqual(["I²C", "SPI", "UART", "USB"]);
  });

  it("is deterministic", () => {
    expect(createDroneReferenceElectronicsArchitecture()).toEqual(createDroneReferenceElectronicsArchitecture());
  });
});
