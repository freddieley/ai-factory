import { describe, expect, it } from "vitest";
import { buildRequirementsDrivenElectronicsArchitecture } from "../src/electronics.js";
import { selectElectronicsComponents } from "../src/electronics-selection.js";
import { analyzeElectronicsEngineering } from "../src/electronics-analysis.js";

const requirements = [
  { id: "R1", description: "12 V input, maximum 5 A", value: 12, unit: "V", priority: "must" as const },
  { id: "R2", description: "controller operating at 2 MHz", priority: "must" as const },
  { id: "R3", description: "CAN interface at 1 MHz", priority: "must" as const },
  { id: "R4", description: "maximum ambient temperature 40 C", priority: "must" as const },
];

function makeArchitecture() { return buildRequirementsDrivenElectronicsArchitecture(requirements, "analysis test"); }

function makeSelection() {
  const architecture = makeArchitecture();
  return selectElectronicsComponents(architecture, [{
    id: "mcu-1", part_number: "MCU-CAN", name: "CAN microcontroller", manufacturer: "Example", category: "microcontroller CAN", lifecycle: "active",
    data_json: JSON.stringify({ voltageMinV: 9, voltageMaxV: 15, currentMaxA: 10, currentDrawA: 0.2, powerW: 1, thermalResistanceCPerW: 5, maximumOperatingTempC: 125, maxFrequencyMHz: 8, impedanceOhm: 120, terminationRequired: true, terminationPresent: true, logicVoltageV: 3.3, connector: "CAN" , protocols: ["CAN"] }),
  }]);
}

describe("electronics engineering analysis", () => {
  it("passes when power, thermal, signal and interface data are complete", () => {
    const architecture = makeArchitecture();
    const selection = makeSelection();
    expect(selection.ruleCheck.status).toBe("pass");
    const analysis = analyzeElectronicsEngineering(architecture, selection);
    expect(analysis.status).toBe("pass");
    expect(analysis.power[0]?.status).toBe("verified");
    expect(analysis.thermal[0]?.status).toBe("verified");
    expect(analysis.signalIntegrity[0]?.status).toBe("verified");
    expect(analysis.interfaces[0]?.status).toBe("verified");
  });

  it("fails explicitly when engineering ratings are missing", () => {
    const architecture = makeArchitecture();
    const selection = selectElectronicsComponents(architecture, [{
      id: "mcu-2", part_number: "MCU-CAN-UNKNOWN", name: "CAN microcontroller", manufacturer: "Example", category: "microcontroller CAN", lifecycle: "active",
      data_json: JSON.stringify({ voltageMinV: 9, voltageMaxV: 15, currentMaxA: 10, protocols: ["CAN"] }),
    }]);
    const analysis = analyzeElectronicsEngineering(architecture, selection);
    expect(analysis.status).toBe("fail");
    expect(analysis.findings.some(finding => finding.rule === "dissipation-known")).toBe(true);
    expect(analysis.findings.some(finding => finding.rule === "impedance-known")).toBe(true);
  });

  it("rejects an over-temperature component deterministically", () => {
    const architecture = makeArchitecture();
    const selection = selectElectronicsComponents(architecture, [{
      id: "mcu-3", part_number: "MCU-CAN-HOT", name: "CAN microcontroller", manufacturer: "Example", category: "microcontroller CAN", lifecycle: "active",
      data_json: JSON.stringify({ voltageMinV: 9, voltageMaxV: 15, currentMaxA: 10, currentDrawA: 0.5, powerW: 10, thermalResistanceCPerW: 10, maximumOperatingTempC: 100, maxFrequencyMHz: 8, impedanceOhm: 120, terminationRequired: true, terminationPresent: true, logicVoltageV: 3.3, connector: "CAN", protocols: ["CAN"] }),
    }]);
    const analysis = analyzeElectronicsEngineering(architecture, selection);
    expect(analysis.status).toBe("fail");
    expect(analysis.findings.some(finding => finding.rule === "temperature-limit" && finding.severity === "error")).toBe(true);
  });
});
