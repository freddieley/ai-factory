import { describe, expect, it } from "vitest";
import { runElectronicsRuleCheck } from "../src/electronics-selection.js";

const architecture = {
  schema: "ai-factory.electronics-architecture/v1",
  name: "erc test",
  requirements: [{ id: "R1", description: "12 V input", value: 12, unit: "V", priority: "must" }],
  powerDomains: [{ name: "12 V rail", nominalVoltageV: 12, requirementIds: ["R1"] }],
  systemMaxCurrentA: 5,
  functionalBlocks: [
    { id: "controller", type: "controller", name: "Control", requirementIds: ["R1"] },
    { id: "communications", type: "communications", name: "CAN telemetry", requirementIds: ["R1"] },
  ],
  interfaces: [{ name: "CAN interface", protocol: "CAN", requirementIds: ["R1"] }],
  openQuestions: [],
};

const candidate = (overrides: Record<string, unknown> = {}) => ({
  componentId: "mcu-1",
  partNumber: "MCU-CAN",
  name: "CAN microcontroller",
  manufacturer: "Example",
  category: "microcontroller CAN",
  lifecycle: "active",
  score: 100,
  matchedBlockTypes: ["controller", "communications"],
  ruleFindings: [],
  ...overrides,
});

describe("electronics electrical rule checking", () => {
  it("passes when selected components cover functional blocks and interfaces", () => {
    const result = runElectronicsRuleCheck(architecture, [candidate()]);
    expect(result).toEqual({ schema: "ai-factory.electronics-erc/v1", status: "pass", findings: [] });
  });

  it("fails when a functional block or interface is uncovered", () => {
    const result = runElectronicsRuleCheck(architecture, [candidate({ matchedBlockTypes: ["controller"], partNumber: "MCU-BARE", name: "microcontroller", category: "microcontroller" })]);
    expect(result.status).toBe("fail");
    expect(result.findings.some(finding => finding.rule === "functional-block-covered" && finding.message.includes("communications"))).toBe(true);
    expect(result.findings.some(finding => finding.rule === "interface-covered" && finding.message.includes("CAN"))).toBe(true);
  });

  it("fails duplicate component identity and inherited candidate findings", () => {
    const result = runElectronicsRuleCheck(architecture, [
      candidate(),
      candidate({ componentId: "mcu-1", partNumber: "MCU-CAN-2" }),
      candidate({ componentId: "mcu-3", partNumber: "MCU-WARN", ruleFindings: [{ rule: "voltage-range-known", severity: "warning", message: "Voltage range unknown" }] }),
    ]);
    expect(result.status).toBe("fail");
    expect(result.findings.some(finding => finding.rule === "unique-component-id")).toBe(true);
    expect(result.findings.some(finding => finding.rule === "candidate-voltage-range-known" && finding.severity === "warning")).toBe(true);
  });
});
