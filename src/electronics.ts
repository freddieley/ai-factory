import { z } from "zod";

export const ElectronicsRequirement = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  value: z.union([z.string(), z.number()]).nullable().optional(),
  unit: z.string().nullable().optional(),
  priority: z.enum(["must", "should", "could"]).default("should"),
  verificationMethod: z.string().nullable().optional(),
});
export type ElectronicsRequirement = z.infer<typeof ElectronicsRequirement>;

const FunctionalBlockType = z.enum(["power", "controller", "sensor", "actuator", "communications", "interface", "safety", "other"]);

export const ElectronicsFunctionalBlock = z.object({
  id: z.string().min(1),
  type: FunctionalBlockType,
  name: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).min(1),
});

export const ElectronicsPowerDomain = z.object({
  name: z.string().min(1),
  nominalVoltageV: z.number().positive(),
  maxCurrentA: z.number().positive().optional(),
  requirementIds: z.array(z.string().min(1)).min(1),
});

export const ElectronicsInterface = z.object({
  name: z.string().min(1),
  protocol: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).min(1),
});

export const ElectronicsArchitecture = z.object({
  schema: z.literal("ai-factory.electronics-architecture/v1"),
  name: z.string().min(1),
  requirements: z.array(ElectronicsRequirement).min(1),
  powerDomains: z.array(ElectronicsPowerDomain),
  functionalBlocks: z.array(ElectronicsFunctionalBlock).min(1),
  interfaces: z.array(ElectronicsInterface),
  openQuestions: z.array(z.string().min(1)),
});
export type ElectronicsArchitecture = z.infer<typeof ElectronicsArchitecture>;

function numericRequirementValue(requirement: ElectronicsRequirement): number | null {
  if (typeof requirement.value === "number" && Number.isFinite(requirement.value)) return requirement.value;
  if (typeof requirement.value !== "string") return null;
  const match = requirement.value.match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizedText(requirement: ElectronicsRequirement): string {
  return `${requirement.description} ${requirement.value ?? ""} ${requirement.unit ?? ""}`.toLowerCase();
}

function inferBlockType(requirement: ElectronicsRequirement): z.infer<typeof FunctionalBlockType> {
  const text = normalizedText(requirement);
  if (/(mcu|microcontroller|controller|processor|cpu|compute)/.test(text)) return "controller";
  if (/(motor|servo|esc|actuator|pump|valve|solenoid)/.test(text)) return "actuator";
  if (/(sensor|imu|camera|lidar|encoder|gps|temperature|pressure|accelerometer|gyroscope)/.test(text)) return "sensor";
  if (/(wifi|wi-fi|bluetooth|ble|can|ethernet|uart|i2c|spi|radio|wireless|usb)/.test(text)) return "communications";
  if (/(fuse|overcurrent|protection|emergency|safety|shutdown|interlock)/.test(text)) return "safety";
  if (/(voltage|current|power|battery|supply|rail|vbus|vin)/.test(text) || requirement.unit?.toUpperCase() === "V" || requirement.unit?.toUpperCase() === "A") return "power";
  return "other";
}

function inferBlockName(type: z.infer<typeof FunctionalBlockType>, requirement: ElectronicsRequirement): string {
  const text = requirement.description.trim();
  if (type === "controller") return "Control and compute";
  if (type === "actuator") return "Actuation";
  if (type === "sensor") return "Sensing";
  if (type === "communications") return "Communications";
  if (type === "power") return "Power subsystem";
  if (type === "safety") return "Electrical safety and protection";
  if (type === "interface") return "External interfaces";
  return text.length <= 64 ? text : `${text.slice(0, 61)}...`;
}

function protocolFromRequirement(requirement: ElectronicsRequirement): string | null {
  const text = normalizedText(requirement);
  const protocols: Array<[RegExp, string]> = [
    [/\bwi-?fi\b/, "Wi-Fi"],
    [/\bbluetooth|\bble\b/, "Bluetooth LE"],
    [/\bcan\b/, "CAN"],
    [/\bethernet\b/, "Ethernet"],
    [/\buart\b/, "UART"],
    [/\bi2c\b/, "I²C"],
    [/\bspi\b/, "SPI"],
    [/\busb\b/, "USB"],
  ];
  return protocols.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function buildRequirementsDrivenElectronicsArchitecture(input: unknown, name = "Requirements-driven electronics architecture"): ElectronicsArchitecture {
  const requirements = z.array(ElectronicsRequirement).min(1).parse(input);
  const powerByVoltage = new Map<number, { requirementIds: string[]; maxCurrentA?: number }>();
  const blocksByType = new Map<z.infer<typeof FunctionalBlockType>, { requirementIds: string[]; name: string }>();
  const interfacesByProtocol = new Map<string, string[]>();

  for (const requirement of requirements) {
    const type = inferBlockType(requirement);
    const existingBlock = blocksByType.get(type);
    if (existingBlock) existingBlock.requirementIds.push(requirement.id);
    else blocksByType.set(type, { requirementIds: [requirement.id], name: inferBlockName(type, requirement) });

    const unit = requirement.unit?.toUpperCase();
    const value = numericRequirementValue(requirement);
    if (unit === "V" && value !== null && value > 0) {
      const domain = powerByVoltage.get(value) ?? { requirementIds: [] };
      domain.requirementIds.push(requirement.id);
      powerByVoltage.set(value, domain);
    }
    if (unit === "A" && value !== null && value > 0) {
      const domain = powerByVoltage.values().next().value as { requirementIds: string[]; maxCurrentA?: number } | undefined;
      if (domain) domain.maxCurrentA = Math.max(domain.maxCurrentA ?? 0, value);
    }

    const protocol = protocolFromRequirement(requirement);
    if (protocol) interfacesByProtocol.set(protocol, [...(interfacesByProtocol.get(protocol) ?? []), requirement.id]);
  }

  const functionalBlocks = [...blocksByType.entries()].map(([type, value]) => ({
    id: `block-${type}`,
    type,
    name: value.name,
    requirementIds: [...new Set(value.requirementIds)],
  }));

  const powerDomains = [...powerByVoltage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([voltage, value]) => ({
      name: `${voltage} V rail`,
      nominalVoltageV: voltage,
      ...(value.maxCurrentA ? { maxCurrentA: value.maxCurrentA } : {}),
      requirementIds: [...new Set(value.requirementIds)],
    }));

  const interfaces = [...interfacesByProtocol.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([protocol, requirementIds]) => ({ name: `${protocol} interface`, protocol, requirementIds: [...new Set(requirementIds)] }));

  const openQuestions = [
    "Select concrete components only after electrical ratings, lifecycle, sourcing, and package constraints are verified.",
    "Define schematic-level connectivity and pin assignments before PCB layout.",
    "Verify power-budget, protection, thermal, signal-integrity, and EMC requirements before release.",
  ];
  if (powerDomains.length === 0) openQuestions.unshift("No explicit voltage requirement was found; define the system input voltage and power domains.");
  if (!functionalBlocks.some(block => block.type === "controller")) openQuestions.unshift("No controller requirement was identified; confirm where control and compute functions reside.");

  return ElectronicsArchitecture.parse({
    schema: "ai-factory.electronics-architecture/v1",
    name,
    requirements,
    powerDomains,
    functionalBlocks,
    interfaces,
    openQuestions,
  });
}
