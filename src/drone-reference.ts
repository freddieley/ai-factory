import { z } from "zod";
import { buildRequirementsDrivenElectronicsArchitecture, ElectronicsArchitecture } from "./electronics.js";

export const DroneReferenceSpecification = z.object({
  schema: z.literal("ai-factory.drone-reference/v1"),
  name: z.string().min(1),
  mission: z.literal("benign-electric-quadrotor-research-platform"),
  requirements: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    value: z.union([z.number(), z.string()]).nullable().optional(),
    unit: z.string().nullable().optional(),
    priority: z.enum(["must", "should", "could"]),
  })).min(1),
});
export type DroneReferenceSpecification = z.infer<typeof DroneReferenceSpecification>;

const REQUIREMENTS: DroneReferenceSpecification["requirements"] = [
  { id: "DRONE-PWR-001", description: "Battery input nominal voltage 14.8 V", value: 14.8, unit: "V", priority: "must" },
  { id: "DRONE-PWR-002", description: "Flight-controller regulated rail 5 V", value: 5, unit: "V", priority: "must" },
  { id: "DRONE-PWR-003", description: "Flight-controller logic rail 3.3 V", value: 3.3, unit: "V", priority: "must" },
  { id: "DRONE-PWR-004", description: "Flight-controller electronics maximum current 2 A", value: 2, unit: "A", priority: "must" },
  { id: "DRONE-CTRL-001", description: "STM32F405RG microcontroller at 168 MHz", value: 168, unit: "MHz", priority: "must" },
  { id: "DRONE-IMU-001", description: "6-axis IMU sensor over SPI", priority: "must" },
  { id: "DRONE-BARO-001", description: "Barometric pressure sensor over I2C", priority: "must" },
  { id: "DRONE-GPS-001", description: "GPS receiver over UART", priority: "must" },
  { id: "DRONE-RC-001", description: "RC receiver input over UART", priority: "must" },
  { id: "DRONE-TEL-001", description: "Telemetry link over UART", priority: "should" },
  { id: "DRONE-USB-001", description: "USB service interface", priority: "should" },
  { id: "DRONE-ESC-001", description: "Four motor ESC actuator outputs", value: 4, unit: "channels", priority: "must" },
  { id: "DRONE-SAFE-001", description: "Arm and motor-output safety shutdown interlock", priority: "must" },
  { id: "DRONE-SENSE-001", description: "Battery voltage and current sensing", priority: "must" },
];

export function createDroneReferenceSpecification(name = "AI Factory Quadrotor Flight Controller"): DroneReferenceSpecification {
  return DroneReferenceSpecification.parse({
    schema: "ai-factory.drone-reference/v1",
    name,
    mission: "benign-electric-quadrotor-research-platform",
    requirements: REQUIREMENTS.map(requirement => ({ ...requirement })),
  });
}

export function createDroneReferenceElectronicsArchitecture(name?: string): ElectronicsArchitecture {
  const specification = createDroneReferenceSpecification(name);
  return buildRequirementsDrivenElectronicsArchitecture(specification.requirements, specification.name);
}
