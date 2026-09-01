import { describe, expect, it } from "vitest";
import { selectElectronicsComponents } from "../src/electronics-selection.js";

const architecture = {
  schema: "ai-factory.electronics-architecture/v1",
  name: "test architecture",
  requirements: [{ id: "R1", description: "12 V input", value: 12, unit: "V", priority: "must" }],
  powerDomains: [{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["R1"] }],
  systemMaxCurrentA: 5,
  functionalBlocks: [{ id: "block-controller", type: "controller", name: "Control and compute", requirementIds: ["R1"] }],
  interfaces: [],
  openQuestions: [],
};

const component = (overrides: Record<string, unknown> = {}) => ({
  id: "component-good",
  part_number: "MCU-GOOD",
  name: "12V microcontroller",
  manufacturer: "Example",
  category: "microcontroller",
  lifecycle: "active",
  data_json: JSON.stringify({ voltageMinV: 9, voltageMaxV: 15, currentMaxA: 10 }),
  ...overrides,
});

describe("electronics component selection", () => {
  it("selects an active component that satisfies voltage, current, and functional-fit rules", () => {
    const result = selectElectronicsComponents(architecture, [component()]);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].partNumber).toBe("MCU-GOOD");
    expect(result.selected[0].ruleFindings.filter(finding => finding.severity === "error")).toHaveLength(0);
  });

  it("rejects a component with insufficient current capacity", () => {
    const result = selectElectronicsComponents(architecture, [component({ id: "component-low-current", part_number: "MCU-LOW-I", data_json: JSON.stringify({ voltageMinV: 9, voltageMaxV: 15, currentMaxA: 2 }) })]);
    expect(result.selected).toHaveLength(0);
    expect(result.blockingFindings.join(" ")).toContain("2 A is below the 5 A system requirement");
  });

  it("rejects obsolete components and reports incomplete ratings as warnings", () => {
    const result = selectElectronicsComponents(architecture, [
      component({ id: "component-obsolete", part_number: "MCU-OLD", lifecycle: "obsolete" }),
      component({ id: "component-unknown", part_number: "MCU-UNKNOWN", data_json: JSON.stringify({}) }),
    ]);
    expect(result.selected).toHaveLength(0);
    expect(result.candidates.find(candidate => candidate.partNumber === "MCU-OLD")?.ruleFindings.some(finding => finding.severity === "error")).toBe(true);
    expect(result.candidates.find(candidate => candidate.partNumber === "MCU-UNKNOWN")?.ruleFindings.some(finding => finding.severity === "warning")).toBe(true);
  });

  it("ranks deterministically by score and part number", () => {
    const result = selectElectronicsComponents(architecture, [
      component({ id: "b", part_number: "MCU-B" }),
      component({ id: "a", part_number: "MCU-A" }),
    ]);
    expect(result.candidates.map(candidate => candidate.partNumber)).toEqual(["MCU-A", "MCU-B"]);
  });
});
