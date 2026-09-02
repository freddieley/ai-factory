import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ElectronicsArchitecture } from "./electronics.js";

const execFileAsync = promisify(execFile);

/**
 * Board-specific architectures supported by the firmware generator.
 *
 * `portable-cpp` is a host-verification target: it proves generated source
 * builds and runs, but it is not board-specific and cannot be flashed.
 *
 * `avr-c` is a real board-specific cross-compilation target: it produces an
 * actual Intel HEX firmware image for the named AVR device using the
 * `avr-gcc` toolchain. Cross-compiling successfully is real verification
 * that the generated firmware is valid for that MCU; it is still not
 * physical flashing or physical hardware-in-the-loop, both of which require
 * a dedicated authorized hardware adapter that does not exist yet.
 */
export const AVR_BOARD_PROFILES: Record<string, { mcu: string; fCpuHz: number }> = {
  "atmega328p": { mcu: "atmega328p", fCpuHz: 16000000 },
  "atmega2560": { mcu: "atmega2560", fCpuHz: 16000000 },
};

const FirmwareTargetShape = z.object({
  name: z.string().min(1),
  architecture: z.enum(["portable-cpp", "avr-c"]),
  toolchain: z.string().min(1).optional(),
  board: z.string().min(1).default("generic"),
});

export const FirmwareTarget = FirmwareTargetShape
  .transform(target => ({ ...target, toolchain: target.toolchain ?? (target.architecture === "avr-c" ? "avr-gcc" : "host-g++") }))
  .superRefine((target, ctx) => {
    if (target.architecture === "portable-cpp" && target.toolchain !== "host-g++") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolchain"], message: `portable-cpp firmware targets require the host-g++ toolchain, received '${target.toolchain}'.` });
    }
    if (target.architecture === "avr-c") {
      if (target.toolchain !== "avr-gcc") { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolchain"], message: `avr-c firmware targets require the avr-gcc toolchain, received '${target.toolchain}'.` }); }
      if (!(target.board in AVR_BOARD_PROFILES)) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["board"], message: `Unknown AVR board '${target.board}'. Supported boards: ${Object.keys(AVR_BOARD_PROFILES).join(", ")}.` }); }
    }
  });
export type FirmwareTarget = z.infer<typeof FirmwareTarget>;
export const FirmwareFile = z.object({ path: z.string().min(1), content: z.string() });
export const FirmwareImage = z.object({ path: z.string().min(1), format: z.enum(["ihex"]) });
export const FirmwareProject = z.object({ schema: z.literal("ai-factory.firmware-project/v1"), name: z.string().min(1), target: FirmwareTarget, architectureHash: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(FirmwareFile).min(1), interfaces: z.array(z.string().min(1)), buildCommand: z.array(z.string().min(1)).min(1), postBuildSteps: z.array(z.array(z.string().min(1)).min(1)).default([]), image: FirmwareImage.optional() });
export type FirmwareProject = z.infer<typeof FirmwareProject>;
export const FirmwareBuildStepResult = z.object({ command: z.array(z.string().min(1)).min(1), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nonnegative() });
export type FirmwareBuildStepResult = z.infer<typeof FirmwareBuildStepResult>;
export const FirmwareBuildResult = z.object({ schema: z.literal("ai-factory.firmware-build/v1"), status: z.enum(["pass", "fail"]), architectureHash: z.string().regex(/^[a-f0-9]{64}$/), compiler: z.string().min(1), command: z.array(z.string().min(1)).min(1), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nonnegative(), postBuildSteps: z.array(FirmwareBuildStepResult).default([]), image: z.object({ path: z.string().min(1), format: z.enum(["ihex"]), content: z.string(), sizeBytes: z.number().int().nonnegative() }).optional() });
export type FirmwareBuildResult = z.infer<typeof FirmwareBuildResult>;

function architectureHash(architecture: ElectronicsArchitecture): string { return createHash("sha256").update(JSON.stringify(architecture)).digest("hex"); }

function portableCppSource(architecture: ElectronicsArchitecture): string {
  const protocols = architecture.interfaces.map(iface => iface.protocol);
  const requirements = architecture.requirements.map(requirement => `${requirement.id}: ${requirement.description}`).join("\\n");
  return `#include <cstdint>\n#include <iostream>\n\nnamespace ai_factory {\nstruct Telemetry { std::uint64_t sequence{}; };\nvoid tick(Telemetry& telemetry) { ++telemetry.sequence; std::cout << "AI_FACTORY_HEARTBEAT " << telemetry.sequence << "\\n"; }\n}\n\nint main() {\n  constexpr const char* protocols = "${protocols.join(", ")}";\n  constexpr const char* requirements = R"REQ(${requirements})REQ";\n  (void)protocols; (void)requirements;\n  ai_factory::Telemetry telemetry;\n  ai_factory::tick(telemetry);\n  return 0;\n}\n`;
}

/**
 * Generates a real, board-specific AVR firmware program that emits the same
 * `AI_FACTORY_HEARTBEAT N` telemetry protocol as the host target, but over a
 * real USART0 UART transmitter driven by direct register writes (no libc
 * stdio, which is not available in this bare-metal context). This is
 * genuine embedded C for the target MCU, not a stub.
 */
function avrCSource(architecture: ElectronicsArchitecture, board: { mcu: string; fCpuHz: number }): string {
  const protocols = architecture.interfaces.map(iface => iface.protocol).join(", ") || "none";
  return `#include <avr/io.h>\n#include <util/delay.h>\n#include <stdint.h>\n\n/* Board: ${board.mcu} @ ${board.fCpuHz}Hz. Interface protocols from architecture: ${protocols}. */\n\n#define AI_FACTORY_BAUD 9600UL\n#define AI_FACTORY_UBRR ((F_CPU / (16UL * AI_FACTORY_BAUD)) - 1)\n\nstatic void ai_factory_uart_init(void) {\n  UBRR0H = (uint8_t)(AI_FACTORY_UBRR >> 8);\n  UBRR0L = (uint8_t)(AI_FACTORY_UBRR & 0xFF);\n  UCSR0B = (1 << TXEN0);\n  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);\n}\n\nstatic void ai_factory_uart_write_char(char c) {\n  while (!(UCSR0A & (1 << UDRE0))) {}\n  UDR0 = (uint8_t)c;\n}\n\nstatic void ai_factory_uart_write_str(const char *s) {\n  while (*s) { ai_factory_uart_write_char(*s++); }\n}\n\nstatic void ai_factory_uart_write_u32(uint32_t value) {\n  char buffer[11];\n  uint8_t i = 0;\n  if (value == 0) { buffer[i++] = '0'; }\n  while (value > 0) { buffer[i++] = (char)('0' + (value % 10)); value /= 10; }\n  while (i > 0) { ai_factory_uart_write_char(buffer[--i]); }\n}\n\nint main(void) {\n  ai_factory_uart_init();\n  uint32_t sequence = 0;\n  for (;;) {\n    sequence++;\n    ai_factory_uart_write_str("AI_FACTORY_HEARTBEAT ");\n    ai_factory_uart_write_u32(sequence);\n    ai_factory_uart_write_char('\\n');\n    _delay_ms(1000);\n  }\n  return 0;\n}\n`;
}

export function generateFirmwareProject(architectureInput: unknown, targetInput: unknown): FirmwareProject {
  const architecture = ElectronicsArchitecture.parse(architectureInput); const target = FirmwareTarget.parse(targetInput); const hash = architectureHash(architecture);
  const interfaces = [...new Set(architecture.interfaces.map(iface => iface.protocol))].sort();

  if (target.architecture === "avr-c") {
    const board = AVR_BOARD_PROFILES[target.board];
    return FirmwareProject.parse({ schema: "ai-factory.firmware-project/v1", name: `${target.name} firmware`, target, architectureHash: hash,
      files: [{ path: "src/main.c", content: avrCSource(architecture, board) }, { path: "README.md", content: `# ${target.name} firmware\n\nGenerated from electronics architecture ${hash}.\n\nThis is a board-specific cross-compiled build for the ${board.mcu} (F_CPU=${board.fCpuHz}Hz) using the avr-gcc toolchain. Building it produces a real Intel HEX firmware image via avr-objcopy. This verifies board-specific cross-compilation only: the image is not flashed to physical hardware, and this target cannot be executed through host HIL because it is not host machine code.\n` }],
      interfaces, buildCommand: ["avr-gcc", `-mmcu=${board.mcu}`, `-DF_CPU=${board.fCpuHz}UL`, "-Os", "-std=c11", "-Wall", "-Wextra", "-Werror", "src/main.c", "-o", "firmware.elf"],
      postBuildSteps: [["avr-objcopy", "-O", "ihex", "-R", ".eeprom", "firmware.elf", "firmware.hex"], ["avr-size", "--format=avr", `--mcu=${board.mcu}`, "firmware.elf"]],
      image: { path: "firmware.hex", format: "ihex" } });
  }

  return FirmwareProject.parse({ schema: "ai-factory.firmware-project/v1", name: `${target.name} firmware`, target, architectureHash: hash,
    files: [{ path: "src/main.cpp", content: portableCppSource(architecture) }, { path: "README.md", content: `# ${target.name} firmware\n\nGenerated from electronics architecture ${hash}.\n\nThis portable build is a host-verification target. A board-specific HAL/toolchain is required before flashing physical hardware.\n` }],
    interfaces, buildCommand: ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "src/main.cpp", "-o", "firmware-test"], postBuildSteps: [] });
}

export async function buildFirmwareProject(projectInput: unknown): Promise<FirmwareBuildResult> {
  const project = FirmwareProject.parse(projectInput);
  const root = await mkdtemp(join(tmpdir(), "ai-factory-firmware-"));
  try {
    for (const file of project.files) { const destination = join(root, file.path); await mkdir(join(destination, ".."), { recursive: true }); await writeFile(destination, file.content, "utf8"); }

    let primary: { stdout: string; stderr: string; exitCode: number };
    try { const { stdout, stderr } = await execFileAsync(project.buildCommand[0], project.buildCommand.slice(1), { cwd: root, maxBuffer: 1024 * 1024 }); primary = { stdout, stderr, exitCode: 0 }; }
    catch (error) { const failure = error as { stdout?: string; stderr?: string; code?: number }; return FirmwareBuildResult.parse({ schema: "ai-factory.firmware-build/v1", status: "fail", architectureHash: project.architectureHash, compiler: project.buildCommand[0], command: project.buildCommand, stdout: failure.stdout ?? "", stderr: failure.stderr ?? String(error), exitCode: typeof failure.code === "number" ? failure.code : 1, postBuildSteps: [] }); }

    const postBuildSteps: FirmwareBuildStepResult[] = [];
    for (const step of project.postBuildSteps) {
      try { const { stdout, stderr } = await execFileAsync(step[0], step.slice(1), { cwd: root, maxBuffer: 1024 * 1024 }); postBuildSteps.push({ command: step, stdout, stderr, exitCode: 0 }); }
      catch (error) {
        const failure = error as { stdout?: string; stderr?: string; code?: number };
        postBuildSteps.push({ command: step, stdout: failure.stdout ?? "", stderr: failure.stderr ?? String(error), exitCode: typeof failure.code === "number" ? failure.code : 1 });
        return FirmwareBuildResult.parse({ schema: "ai-factory.firmware-build/v1", status: "fail", architectureHash: project.architectureHash, compiler: project.buildCommand[0], command: project.buildCommand, stdout: primary.stdout, stderr: primary.stderr, exitCode: primary.exitCode, postBuildSteps });
      }
    }

    let image: { path: string; format: "ihex"; content: string; sizeBytes: number } | undefined;
    if (project.image) { const content = await readFile(join(root, project.image.path), "utf8"); image = { path: project.image.path, format: project.image.format, content, sizeBytes: Buffer.byteLength(content, "utf8") }; }

    return FirmwareBuildResult.parse({ schema: "ai-factory.firmware-build/v1", status: "pass", architectureHash: project.architectureHash, compiler: project.buildCommand[0], command: project.buildCommand, stdout: primary.stdout, stderr: primary.stderr, exitCode: primary.exitCode, postBuildSteps, image });
  } finally { await rm(root, { recursive: true, force: true }); }
}
