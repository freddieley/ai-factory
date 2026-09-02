import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ElectronicsArchitecture } from "./electronics.js";

const execFileAsync = promisify(execFile);

export const FirmwareTarget = z.object({ name: z.string().min(1), architecture: z.enum(["portable-cpp"]), toolchain: z.string().min(1).default("host-g++"), board: z.string().min(1).default("generic") });
export type FirmwareTarget = z.infer<typeof FirmwareTarget>;
export const FirmwareFile = z.object({ path: z.string().min(1), content: z.string() });
export const FirmwareProject = z.object({ schema: z.literal("ai-factory.firmware-project/v1"), name: z.string().min(1), target: FirmwareTarget, architectureHash: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(FirmwareFile).min(1), interfaces: z.array(z.string().min(1)), buildCommand: z.array(z.string().min(1)).min(1) });
export type FirmwareProject = z.infer<typeof FirmwareProject>;
export const FirmwareBuildResult = z.object({ schema: z.literal("ai-factory.firmware-build/v1"), status: z.enum(["pass", "fail"]), architectureHash: z.string().regex(/^[a-f0-9]{64}$/), compiler: z.string().min(1), command: z.array(z.string().min(1)).min(1), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nonnegative() });
export type FirmwareBuildResult = z.infer<typeof FirmwareBuildResult>;

function architectureHash(architecture: ElectronicsArchitecture): string { return createHash("sha256").update(JSON.stringify(architecture)).digest("hex"); }
function firmwareSource(architecture: ElectronicsArchitecture): string {
  const protocols = architecture.interfaces.map(iface => iface.protocol);
  const requirements = architecture.requirements.map(requirement => `${requirement.id}: ${requirement.description}`).join("\\n");
  return `#include <cstdint>\n#include <iostream>\n\nnamespace ai_factory {\nstruct Telemetry { std::uint64_t sequence{}; };\nvoid tick(Telemetry& telemetry) { ++telemetry.sequence; std::cout << "AI_FACTORY_HEARTBEAT " << telemetry.sequence << "\\n"; }\n}\n\nint main() {\n  constexpr const char* protocols = "${protocols.join(", ")}";\n  constexpr const char* requirements = R"REQ(${requirements})REQ";\n  (void)protocols; (void)requirements;\n  ai_factory::Telemetry telemetry;\n  ai_factory::tick(telemetry);\n  return 0;\n}\n`;
}
export function generateFirmwareProject(architectureInput: unknown, targetInput: unknown): FirmwareProject {
  const architecture = ElectronicsArchitecture.parse(architectureInput); const target = FirmwareTarget.parse(targetInput); const hash = architectureHash(architecture);
  return FirmwareProject.parse({ schema: "ai-factory.firmware-project/v1", name: `${target.name} firmware`, target, architectureHash: hash,
    files: [{ path: "src/main.cpp", content: firmwareSource(architecture) }, { path: "README.md", content: `# ${target.name} firmware\\n\\nGenerated from electronics architecture ${hash}.\\n\\nThis portable build is a host-verification target. A board-specific HAL/toolchain is required before flashing physical hardware.\\n` }],
    interfaces: [...new Set(architecture.interfaces.map(iface => iface.protocol))].sort(), buildCommand: ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "src/main.cpp", "-o", "firmware-test"] });
}
export async function buildFirmwareProject(projectInput: unknown): Promise<FirmwareBuildResult> {
  const project = FirmwareProject.parse(projectInput); if (project.target.toolchain !== "host-g++") throw new Error(`Unsupported firmware toolchain: ${project.target.toolchain}`);
  const root = await mkdtemp(join(tmpdir(), "ai-factory-firmware-"));
  try {
    for (const file of project.files) { const destination = join(root, file.path); await mkdir(join(destination, ".."), { recursive: true }); await writeFile(destination, file.content, "utf8"); }
    try { const { stdout, stderr } = await execFileAsync(project.buildCommand[0], project.buildCommand.slice(1), { cwd: root, maxBuffer: 1024 * 1024 }); return FirmwareBuildResult.parse({ schema: "ai-factory.firmware-build/v1", status: "pass", architectureHash: project.architectureHash, compiler: project.buildCommand[0], command: project.buildCommand, stdout, stderr, exitCode: 0 }); }
    catch (error) { const failure = error as { stdout?: string; stderr?: string; code?: number }; return FirmwareBuildResult.parse({ schema: "ai-factory.firmware-build/v1", status: "fail", architectureHash: project.architectureHash, compiler: project.buildCommand[0], command: project.buildCommand, stdout: failure.stdout ?? "", stderr: failure.stderr ?? String(error), exitCode: typeof failure.code === "number" ? failure.code : 1 }); }
  } finally { await rm(root, { recursive: true, force: true }); }
}
