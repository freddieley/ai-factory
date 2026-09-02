import { z } from "zod";
import { ElectronicsArchitecture } from "./electronics.js";

export const ElectronicsComponentCandidate = z.object({
  componentId: z.string().min(1),
  partNumber: z.string().min(1),
  name: z.string().min(1),
  manufacturer: z.string().nullable().optional(),
  category: z.string().min(1),
  lifecycle: z.enum(["active", "nrnd", "obsolete", "unknown"]),
  score: z.number(),
  matchedBlockTypes: z.array(z.string()),
  ruleFindings: z.array(z.object({
    rule: z.string().min(1),
    severity: z.enum(["error", "warning", "info"]),
    message: z.string().min(1),
  })),
});
export type ElectronicsComponentCandidate = z.infer<typeof ElectronicsComponentCandidate>;

export const ElectronicsRuleFinding = z.object({
  rule: z.string().min(1),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string().min(1),
});
export type ElectronicsRuleFinding = z.infer<typeof ElectronicsRuleFinding>;

export const ElectronicsRuleCheck = z.object({
  schema: z.literal("ai-factory.electronics-erc/v1"),
  status: z.enum(["pass", "fail"]),
  findings: z.array(ElectronicsRuleFinding),
});
export type ElectronicsRuleCheck = z.infer<typeof ElectronicsRuleCheck>;

export const ElectronicsComponentSelection = z.object({
  schema: z.literal("ai-factory.electronics-component-selection/v1"),
  architectureSchema: z.literal("ai-factory.electronics-architecture/v1"),
  candidates: z.array(ElectronicsComponentCandidate),
  selected: z.array(ElectronicsComponentCandidate),
  rejectedCount: z.number().int().nonnegative(),
  blockingFindings: z.array(z.string()),
  ruleCheck: ElectronicsRuleCheck,
});
export type ElectronicsComponentSelection = z.infer<typeof ElectronicsComponentSelection>;

type StoredComponent = {
  id: string;
  part_number: string;
  name: string;
  manufacturer: string | null;
  category: string;
  lifecycle: "active" | "nrnd" | "obsolete" | "unknown";
  data_json: string | null;
};

type ComponentData = {
  voltageMinV?: number;
  voltageMaxV?: number;
  currentMaxA?: number;
};

function componentData(component: StoredComponent): ComponentData {
  try {
    const parsed = component.data_json ? JSON.parse(component.data_json) : {};
    return {
      voltageMinV: typeof parsed.voltageMinV === "number" ? parsed.voltageMinV : undefined,
      voltageMaxV: typeof parsed.voltageMaxV === "number" ? parsed.voltageMaxV : undefined,
      currentMaxA: typeof parsed.currentMaxA === "number" ? parsed.currentMaxA : undefined,
    };
  } catch {
    return {};
  }
}

function blockKeywords(type: string): string[] {
  return {
    controller: ["mcu", "microcontroller", "processor", "controller", "compute", "soc"],
    sensor: ["sensor", "imu", "camera", "lidar", "encoder", "gps"],
    actuator: ["motor", "servo", "esc", "actuator", "pump", "valve"],
    communications: ["wifi", "wi-fi", "bluetooth", "ble", "can", "ethernet", "uart", "i2c", "spi", "usb", "radio"],
    power: ["regulator", "converter", "power", "battery", "supply", "charger", "pmic"],
    safety: ["fuse", "protection", "switch", "shutdown", "interlock"],
    interface: ["connector", "interface", "usb", "header"],
    other: [],
  }[type as keyof Record<string, string[]>] ?? [];
}

function hasCategoryMatch(component: StoredComponent, blockType: string): boolean {
  const text = `${component.category} ${component.name} ${component.part_number}`.toLowerCase();
  return blockKeywords(blockType).some(keyword => text.includes(keyword));
}

function protocolMatches(candidate: ElectronicsComponentCandidate, protocol: string): boolean {
  const normalizedProtocol = protocol.toLowerCase().replace(/[^a-z0-9]/g, "");
  const text = `${candidate.category} ${candidate.name} ${candidate.partNumber}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalizedProtocol.length > 0 && text.includes(normalizedProtocol);
}

export function runElectronicsRuleCheck(architectureInput: unknown, selectedInput: unknown): ElectronicsRuleCheck {
  const architecture = ElectronicsArchitecture.parse(architectureInput);
  const selected = z.array(ElectronicsComponentCandidate).parse(selectedInput);
  const findings: ElectronicsRuleFinding[] = [];

  const ids = new Set<string>();
  const partNumbers = new Set<string>();
  for (const candidate of selected) {
    if (ids.has(candidate.componentId)) findings.push({ rule: "unique-component-id", severity: "error", message: `Component ${candidate.componentId} is selected more than once.` });
    ids.add(candidate.componentId);
    if (partNumbers.has(candidate.partNumber)) findings.push({ rule: "unique-part-number", severity: "error", message: `Part number ${candidate.partNumber} is selected more than once.` });
    partNumbers.add(candidate.partNumber);
    if (candidate.lifecycle !== "active") findings.push({ rule: "selected-active", severity: "error", message: `${candidate.partNumber} is not active and cannot be part of a verified selection.` });
    for (const ruleFinding of candidate.ruleFindings) {
      if (ruleFinding.severity !== "info") findings.push({ rule: `candidate-${ruleFinding.rule}`, severity: ruleFinding.severity, message: `${candidate.partNumber}: ${ruleFinding.message}` });
    }
  }

  if (selected.length === 0) {
    findings.push({ rule: "selection-nonempty", severity: "error", message: "No electrically valid component has been selected." });
  }

  for (const block of architecture.functionalBlocks) {
    const covered = selected.some(candidate => candidate.matchedBlockTypes.includes(block.type));
    if (!covered) findings.push({ rule: "functional-block-covered", severity: "error", message: `Functional block ${block.name} (${block.type}) has no selected component providing a declared functional fit.` });
  }

  for (const iface of architecture.interfaces) {
    const covered = selected.some(candidate => protocolMatches(candidate, iface.protocol));
    if (!covered) findings.push({ rule: "interface-covered", severity: "error", message: `Interface ${iface.name} (${iface.protocol}) has no selected component whose catalog identity declares that protocol.` });
  }

  const errors = findings.filter(finding => finding.severity === "error");
  const warnings = findings.filter(finding => finding.severity === "warning");
  if (warnings.length > 0 && errors.length === 0) {
    findings.push({ rule: "erc-warning", severity: "warning", message: `${warnings.length} electrical rule warning(s) require engineering review.` });
  }
  return ElectronicsRuleCheck.parse({
    schema: "ai-factory.electronics-erc/v1",
    status: errors.length === 0 && warnings.length === 0 ? "pass" : "fail",
    findings,
  });
}

export function selectElectronicsComponents(architectureInput: unknown, componentsInput: unknown, resultLimit = 20): ElectronicsComponentSelection {
  const architecture = ElectronicsArchitecture.parse(architectureInput);
  const components = z.array(z.any()).parse(componentsInput) as StoredComponent[];
  const limit = Math.max(1, Math.min(100, Math.trunc(resultLimit)));
  const voltageRequirements = architecture.powerDomains.map(domain => domain.nominalVoltageV);
  const systemCurrent = architecture.systemMaxCurrentA;
  const blockTypes = architecture.functionalBlocks.map(block => block.type);

  const candidates: ElectronicsComponentCandidate[] = components.map(component => {
    const data = componentData(component);
    const findings: ElectronicsComponentCandidate["ruleFindings"] = [];
    const matchedBlockTypes = blockTypes.filter(type => hasCategoryMatch(component, type));
    let score = 0;

    if (component.lifecycle !== "active") {
      findings.push({ rule: "lifecycle-active", severity: component.lifecycle === "unknown" ? "warning" : "error", message: `Component lifecycle is ${component.lifecycle}; active lifecycle is required for selection.` });
    } else score += 25;

    if (voltageRequirements.length > 0) {
      if (data.voltageMinV === undefined || data.voltageMaxV === undefined) {
        findings.push({ rule: "voltage-range-known", severity: "warning", message: "Component voltage range is incomplete; electrical compatibility cannot be fully verified." });
      } else if (voltageRequirements.some(voltage => voltage < data.voltageMinV! || voltage > data.voltageMaxV!)) {
        findings.push({ rule: "voltage-range", severity: "error", message: `Component voltage range ${data.voltageMinV}-${data.voltageMaxV} V does not cover every required power-domain voltage.` });
      } else score += 30;
    }

    if (systemCurrent !== undefined) {
      if (data.currentMaxA === undefined) {
        findings.push({ rule: "current-rating-known", severity: "warning", message: "Component maximum current rating is unknown; current capacity cannot be fully verified." });
      } else if (data.currentMaxA < systemCurrent) {
        findings.push({ rule: "current-capacity", severity: "error", message: `Component current rating ${data.currentMaxA} A is below the ${systemCurrent} A system requirement.` });
      } else score += 25;
    }

    if (matchedBlockTypes.length > 0) score += Math.min(20, matchedBlockTypes.length * 10);
    else findings.push({ rule: "functional-fit", severity: "warning", message: "Component category/name does not clearly match an identified functional block." });

    const errors = findings.filter(finding => finding.severity === "error");
    score -= errors.length * 100;
    return ElectronicsComponentCandidate.parse({
      componentId: component.id,
      partNumber: component.part_number,
      name: component.name,
      manufacturer: component.manufacturer,
      category: component.category,
      lifecycle: component.lifecycle,
      score,
      matchedBlockTypes,
      ruleFindings: findings,
    });
  });

  const ranked = candidates.sort((a, b) => b.score - a.score || a.partNumber.localeCompare(b.partNumber) || a.componentId.localeCompare(b.componentId));
  const selected = ranked.filter(candidate => candidate.lifecycle === "active" && !candidate.ruleFindings.some(finding => finding.severity !== "info") && candidate.matchedBlockTypes.length > 0).slice(0, limit);
  const blockingFindings = ranked
    .filter(candidate => candidate.lifecycle === "active" && candidate.ruleFindings.some(finding => finding.severity === "error" || finding.severity === "warning"))
    .slice(0, 10)
    .map(candidate => `${candidate.partNumber}: ${candidate.ruleFindings.filter(finding => finding.severity !== "info").map(finding => finding.message).join(" ")}`);
  const ruleCheck = runElectronicsRuleCheck(architecture, selected);

  return ElectronicsComponentSelection.parse({
    schema: "ai-factory.electronics-component-selection/v1",
    architectureSchema: architecture.schema,
    candidates: ranked.slice(0, limit),
    selected,
    rejectedCount: Math.max(0, ranked.length - selected.length),
    blockingFindings,
    ruleCheck,
  });
}
