import { createHash } from "node:crypto";
import { z } from "zod";
import { ElectronicsArchitecture } from "./electronics.js";

export const FirmwareTarget = z.object({
  name: z.string().min(1),
  architecture: z.enum(["portable-cpp"]),
  toolchain: z.string().min(1).default("host-g++"),
  board: z.string().min(1).default("generic"),
});
export type FirmwareTarget = z.infer<typeof FirmwareTarget>;

export const FirmwareFile = z.object({ path: z.string().min(1), content: z.string() });
export const FirmwareProject = z.object({
  schema: z.literal("ai-factory.firmware-project/v1"),
  name: z.string().min(1),
  target: FirmwareTarget,
  architectureHash: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(FirmwareFile).min(1),
  interfaces: z.array(z.string().min(1)),
  buildCommand: z.array(z.string().min(1)).min(1),
});
export type FirmwareProject = z.infer<typeof FirmwareProject>;

function architectureHash(architecture: ElectronicsArchitecture): string {
  return createHash("sha256").update(JSON.stringify(architecture)).digest("hex");
}

function firmwareSource(architecture: ElectronicsArchitecture): string {
  const protocols = architecture.interfaces.map(iface => iface.protocol);
  const requirements = architecture.requirements.map(requirement => `${requirement.id}: ${requirement.description}`).join("\\n");
  return `#include <cstdint>\n#include <iostream>\n\nnamespace ai_factory {\nstruct Telemetry {\n  std::uint64_t sequence{};\n};\n\nvoid tick(Telemetry& telemetry) {\n  ++telemetry.sequence;\n  std::cout << "AI_FACTORY_HEARTBEAT " << telemetry.sequence << "\\n";\n}\n}\n\nint main() {\n  // Generated from the validated electronics architecture.\n  // Target HAL and hardware drivers must be supplied before physical flashing.\n  constexpr const char* protocols = "${protocols.join(", ")}";\n  constexpr const char* requirements = R"REQ(${requirements})REQ";\n  (void)protocols;\n  (void)requirements;\n  ai_factory::Telemetry telemetry;\n  ai_factory::tick(telemetry);\n  return 0;\n}\n`;
}

export function generateFirmwareProject(architectureInput: unknown, targetInput: unknown): FirmwareProject {
  const architecture = ElectronicsArchitecture.parse(architectureInput);
  const target = FirmwareTarget.parse(targetInput);
  const source = firmwareSource(architecture);
  return FirmwareProject.parse({
    schema: "ai-factory.firmware-project/v1",
    name: `${target.name} firmware`,
    target,
    architectureHash: architectureHash(architecture),
    files: [
      { path: "src/main.cpp", content: source },
      { path: "README.md", content: `# ${target.name} firmware\\n\\nGenerated from electronics architecture ${architectureHash(architecture)}.\\n\\nThis portable build is a host-verification target. A board-specific HAL/toolchain is required before flashing physical hardware.\\n` },
    ],
    interfaces: [...new Set(architecture.interfaces.map(iface => iface.protocol))].sort(),
    buildCommand: ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "src/main.cpp", "-o", "firmware-test"],
  });
}
