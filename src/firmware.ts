import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { ElectronicsArchitecture } from "./electronics.js";

const execFileAsync = promisify(execFile);

export const AVR_BOARD_PROFILES: Record<string, { mcu: string; fCpuHz: number }> = {
  "atmega328p": { mcu: "atmega328p", fCpuHz: 16000000 },
  "atmega2560": { mcu: "atmega2560", fCpuHz: 16000000 },
};

export const STM32_BOARD_PROFILES: Record<string, { mcu: string; fCpuHz: number }> = {
  "stm32f405rg": { mcu: "stm32f405rg", fCpuHz: 16000000 },
};

const FirmwareTargetShape = z.object({
  name: z.string().min(1),
  architecture: z.enum(["portable-cpp", "avr-c", "arm-c"]),
  toolchain: z.string().min(1).optional(),
  board: z.string().min(1).default("generic"),
});

export const FirmwareTarget = FirmwareTargetShape
  .transform(target => ({ ...target, toolchain: target.toolchain ?? (target.architecture === "avr-c" ? "avr-gcc" : target.architecture === "arm-c" ? "arm-none-eabi-gcc" : "host-g++") }))
  .superRefine((target, ctx) => {
    if (target.architecture === "portable-cpp" && target.toolchain !== "host-g++") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolchain"], message: `portable-cpp firmware targets require the host-g++ toolchain, received '${target.toolchain}'.` });
    if (target.architecture === "avr-c") {
      if (target.toolchain !== "avr-gcc") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolchain"], message: `avr-c firmware targets require the avr-gcc toolchain, received '${target.toolchain}'.` });
      if (!(target.board in AVR_BOARD_PROFILES)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["board"], message: `Unknown AVR board '${target.board}'. Supported boards: ${Object.keys(AVR_BOARD_PROFILES).join(", ")}.` });
    }
    if (target.architecture === "arm-c") {
      if (target.toolchain !== "arm-none-eabi-gcc") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toolchain"], message: `arm-c firmware targets require the arm-none-eabi-gcc toolchain, received '${target.toolchain}'.` });
      if (!(target.board in STM32_BOARD_PROFILES)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["board"], message: `Unknown ARM board '${target.board}'. Supported boards: ${Object.keys(STM32_BOARD_PROFILES).join(", ")}.` });
    }
  });
export type FirmwareTarget = z.infer<typeof FirmwareTarget>;
export const FirmwareFile = z.object({ path: z.string().min(1), content: z.string() });
export const FirmwareImage = z.object({ path: z.string().min(1), format: z.enum(["ihex"]) });
export const FirmwareProject = z.object({ schema: z.literal("ai-factory.firmware-project/v1"), name: z.string().min(1), target: FirmwareTarget, architectureHash: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(FirmwareFile).min(1), interfaces: z.array(z.string().min(1)), buildCommand: z.array(z.string().min(1)).min(1), postBuildSteps: z.array(z.array(z.string().min(1)).min(1)).default([]), image: FirmwareImage.optional() });
export type FirmwareProject = z.infer<typeof FirmwareProject>;
export const FirmwareBuildStepResult = z.object({ command: z.array(z.string().min(1)).min(1), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nonnegative() });
export type FirmwareBuildStepResult = z.infer<typeof FirmwareBuildStepResult>;
export const FirmwareBuildResult = z.object({ schema: z.literal("ai-factory.firmware-build/v1"), status: z.enum(["pass", "fail"]), architectureHash: z.string().regex(/^[a-f0-9]{64}$/), compiler: z.string().min(1), command: z.array(z.string().min(1)).min(1), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nonnegative(), postBuildSteps: z.array(FirmwareBuildStepResult).default([]), image: z.object({ path: z.string(), format: z.enum(["ihex"]), content: z.string(), sizeBytes: z.number().int().nonnegative() }).optional() });
export type FirmwareBuildResult = z.infer<typeof FirmwareBuildResult>;

function architectureHash(architecture: ElectronicsArchitecture): string { return createHash("sha256").update(JSON.stringify(architecture)).digest("hex"); }

function portableCppSource(architecture: ElectronicsArchitecture): string {
  const protocols = architecture.interfaces.map(iface => iface.protocol);
  const requirements = architecture.requirements.map(requirement => `${requirement.id}: ${requirement.description}`).join("\\n");
  return `#include <cstdint>\n#include <iostream>\n\nnamespace ai_factory {\nstruct Telemetry { std::uint64_t sequence{}; };\nvoid tick(Telemetry& telemetry) { ++telemetry.sequence; std::cout << "AI_FACTORY_HEARTBEAT " << telemetry.sequence << "\\n"; }\n}\n\nint main() {\n  constexpr const char* protocols = "${protocols.join(", ")}";\n  constexpr const char* requirements = R"REQ(${requirements})REQ";\n  (void)protocols; (void)requirements;\n  ai_factory::Telemetry telemetry;\n  ai_factory::tick(telemetry);\n  return 0;\n}\n`;
}

function avrCSource(architecture: ElectronicsArchitecture, board: { mcu: string; fCpuHz: number }): string {
  const protocols = architecture.interfaces.map(iface => iface.protocol).join(", ") || "none";
  return `#include <avr/io.h>\n#include <util/delay.h>\n#include <stdint.h>\n\n/* Board: ${board.mcu} @ ${board.fCpuHz}Hz. Interface protocols: ${protocols}. */\n#define AI_FACTORY_BAUD 9600UL\n#define AI_FACTORY_UBRR ((F_CPU / (16UL * AI_FACTORY_BAUD)) - 1)\nstatic void uart_init(void) { UBRR0H = (uint8_t)(AI_FACTORY_UBRR >> 8); UBRR0L = (uint8_t)(AI_FACTORY_UBRR & 0xFF); UCSR0B = (1 << TXEN0); UCSR0C = (1 << UCSZ01) | (1 << UCSZ00); }\nstatic void uart_char(char c) { while (!(UCSR0A & (1 << UDRE0))) {} UDR0 = (uint8_t)c; }\nstatic void uart_str(const char *s) { while (*s) uart_char(*s++); }\nstatic void uart_u32(uint32_t value) { char buffer[11]; uint8_t i = 0; if (value == 0) buffer[i++] = '0'; while (value > 0) { buffer[i++] = (char)('0' + (value % 10)); value /= 10; } while (i > 0) uart_char(buffer[--i]); }\nint main(void) { uart_init(); uint32_t sequence = 0; for (;;) { uart_str("AI_FACTORY_HEARTBEAT "); uart_u32(++sequence); uart_char('\\n'); _delay_ms(1000); } }\n`;
}

function stm32F405Source(architecture: ElectronicsArchitecture, board: { mcu: string; fCpuHz: number }): string {
  const protocols = architecture.interfaces.map(iface => iface.protocol).join(", ") || "none";
  return `#include <stdint.h>\n\n/* STM32F405RG, ${board.fCpuHz}Hz HSI clock. Generated protocols: ${protocols}. */\n#define RCC_BASE 0x40023800UL\n#define RCC_AHB1ENR (*(volatile uint32_t *)(RCC_BASE + 0x30))\n#define RCC_APB1ENR (*(volatile uint32_t *)(RCC_BASE + 0x40))\n#define GPIOA_BASE 0x40020000UL\n#define GPIOA_MODER (*(volatile uint32_t *)(GPIOA_BASE + 0x00))\n#define GPIOA_AFRL (*(volatile uint32_t *)(GPIOA_BASE + 0x20))\n#define USART2_BASE 0x40004400UL\n#define USART2_SR (*(volatile uint32_t *)(USART2_BASE + 0x00))\n#define USART2_DR (*(volatile uint32_t *)(USART2_BASE + 0x04))\n#define USART2_BRR (*(volatile uint32_t *)(USART2_BASE + 0x08))\n#define USART2_CR1 (*(volatile uint32_t *)(USART2_BASE + 0x0C))\n#define GPIOAEN (1UL << 0)\n#define USART2EN (1UL << 17)\n#define TXE (1UL << 7)\n#define UE (1UL << 13)\n#define TE (1UL << 3)\n\nstatic void delay(volatile uint32_t count) { while (count--) __asm__ volatile ("nop"); }\nstatic void uart_init(void) {\n  RCC_AHB1ENR |= GPIOAEN; RCC_APB1ENR |= USART2EN;\n  GPIOA_MODER = (GPIOA_MODER & ~(3UL << 4)) | (2UL << 4);\n  GPIOA_AFRL = (GPIOA_AFRL & ~(0xFUL << 8)) | (7UL << 8);\n  USART2_BRR = ${Math.round(board.fCpuHz / 9600)}UL; USART2_CR1 = UE | TE;\n}\nstatic void uart_char(char c) { while (!(USART2_SR & TXE)) {} USART2_DR = (uint32_t)(uint8_t)c; }\nstatic void uart_str(const char *s) { while (*s) uart_char(*s++); }\nstatic void uart_u32(uint32_t value) { char buffer[11]; uint32_t i = 0; if (!value) buffer[i++] = '0'; while (value) { buffer[i++] = (char)('0' + (value % 10)); value /= 10; } while (i) uart_char(buffer[--i]); }\nint main(void) { uart_init(); uint32_t sequence = 0; for (;;) { uart_str("AI_FACTORY_HEARTBEAT "); uart_u32(++sequence); uart_char('\\n'); delay(${Math.max(1, Math.round(board.fCpuHz / 1000))}UL); } }\nvoid Default_Handler(void) { for (;;) {} }\n__attribute__((section(".isr_vector"), used)) const uintptr_t vector_table[] = { 0x20020000UL, (uintptr_t)main, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler, (uintptr_t)Default_Handler };\n`;
}

function stm32LinkerScript(): string {
  return `MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 1024K RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 128K }\nSECTIONS { .isr_vector : { KEEP(*(.isr_vector)) } > FLASH .text : { *(.text*) *(.rodata*) } > FLASH .data : { *(.data*) } > RAM .bss : { *(.bss*) *(COMMON) } > RAM }\n`;
}

export function generateFirmwareProject(architectureInput: unknown, targetInput: unknown): FirmwareProject {
  const architecture = ElectronicsArchitecture.parse(architectureInput); const target = FirmwareTarget.parse(targetInput); const hash = architectureHash(architecture);
  const interfaces = [...new Set(architecture.interfaces.map(iface => iface.protocol))].sort();
  if (target.architecture === "avr-c") {
    const board = AVR_BOARD_PROFILES[target.board];
    return FirmwareProject.parse({ schema: "ai-factory.firmware-project/v1", name: `${target.name} firmware`, target, architectureHash: hash, files: [{ path: "src/main.c", content: avrCSource(architecture, board) }, { path: "README.md", content: `# ${target.name} firmware\\n\\nGenerated for ${board.mcu}.` }], interfaces, buildCommand: ["avr-gcc", `-mmcu=${board.mcu}`, `-DF_CPU=${board.fCpuHz}UL`, "-Os", "-std=c11", "-Wall", "-Wextra", "-Werror", "src/main.c", "-o", "firmware.elf"], postBuildSteps: [["avr-objcopy", "-O", "ihex", "-R", ".eeprom", "firmware.elf", "firmware.hex"], ["avr-size", "--format=avr", `--mcu=${board.mcu}`, "firmware.elf"]], image: { path: "firmware.hex", format: "ihex" } });
  }
  if (target.architecture === "arm-c") {
    const board = STM32_BOARD_PROFILES[target.board];
    return FirmwareProject.parse({ schema: "ai-factory.firmware-project/v1", name: `${target.name} firmware`, target, architectureHash: hash, files: [{ path: "src/main.c", content: stm32F405Source(architecture, board) }, { path: "linker.ld", content: stm32LinkerScript() }, { path: "README.md", content: `# ${target.name} firmware\\n\\nGenerated for ${board.mcu} using arm-none-eabi-gcc. USART2 TX is PA2 using the default 16MHz HSI clock. The generated HEX is a board-specific image, but this project has not been physically flashed or flight-tested.` }], interfaces, buildCommand: ["arm-none-eabi-gcc", "-mcpu=cortex-m4", "-mthumb", "-mfloat-abi=soft", "-ffreestanding", "-fno-builtin", "-Os", "-Wall", "-Wextra", "-Werror", "-std=c11", "-ffunction-sections", "-fdata-sections", "-T", "linker.ld", "src/main.c", "-nostdlib", "-Wl,--gc-sections", "-o", "firmware.elf"], postBuildSteps: [["arm-none-eabi-objcopy", "-O", "ihex", "-R", ".note.gnu.build-id", "firmware.elf", "firmware.hex"], ["arm-none-eabi-size", "firmware.elf"]], image: { path: "firmware.hex", format: "ihex" } });
  }
  return FirmwareProject.parse({ schema: "ai-factory.firmware-project/v1", name: `${target.name} firmware`, target, architectureHash: hash, files: [{ path: "src/main.cpp", content: portableCppSource(architecture) }, { path: "README.md", content: `# ${target.name} firmware\\n\\nGenerated from electronics architecture ${hash}.\\n\\nThis portable build is a host-verification target. A board-specific HAL/toolchain is required before physical flashing.` }], interfaces, buildCommand: ["g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "src/main.cpp", "-o", "firmware-test"], postBuildSteps: [] });
}

export async function buildFirmwareProject(projectInput: unknown): Promise<FirmwareBuildResult> {
  const project = FirmwareProject.parse(projectInput); const root = await mkdtemp(join(tmpdir(), "ai-factory-firmware-"));
  try {
    for (const file of project.files) { const destination = join(root, file.path); await mkdir(join(destination, ".."), { recursive: true }); await writeFile(destination, file.content, "utf8"); }
    let primary: { stdout: string; stderr: string; exitCode: number };
    try { const { stdout, stderr } = await execFileAsync(project.buildCommand[0], project.buildCommand.slice(1), { cwd: root, maxBuffer: 1024 * 1024 }); primary = { stdout, stderr, exitCode: 0 }; }
    catch (error) { const failure = error as { stdout?: string; stderr?: string; code?: number }; return FirmwareBuildResult.parse({ schema: "ai-factory.firmware-build/v1", status: "fail", architectureHash: project.architectureHash, compiler: project.buildCommand[0], command: project.buildCommand, stdout: failure.stdout ?? "", stderr: failure.stderr ?? String(error), exitCode: typeof failure.code === "number" ? failure.code : 1, postBuildSteps: [] }); }
    const postBuildSteps: FirmwareBuildStepResult[] = [];
    for (const step of project.postBuildSteps) {
      try { const { stdout, stderr } = await execFileAsync(step[0], step.slice(1), { cwd: root, maxBuffer: 1024 * 1024 }); postBuildSteps.push({ command: step, stdout, stderr, exitCode: 0 }); }
      catch (error) { const failure = error as { stdout?: string; stderr?: string; code?: number }; postBuildSteps.push({ command: step, stdout: failure.stdout ?? "", stderr: failure.stderr ?? String(error), exitCode: typeof failure.code === "number" ? failure.code : 1 }); return FirmwareBuildResult.parse({ schema: "ai-factory.firmware-build/v1", status: "fail", architectureHash: project.architectureHash, compiler: project.buildCommand[0], command: project.buildCommand, stdout: primary.stdout, stderr: primary.stderr, exitCode: primary.exitCode, postBuildSteps }); }
    }
    let image: { path: string; format: "ihex"; content: string; sizeBytes: number } | undefined;
    if (project.image) { const content = await readFile(join(root, project.image.path), "utf8"); image = { path: project.image.path, format: project.image.format, content, sizeBytes: Buffer.byteLength(content, "utf8") }; }
    return FirmwareBuildResult.parse({ schema: "ai-factory.firmware-build/v1", status: "pass", architectureHash: project.architectureHash, compiler: project.buildCommand[0], command: project.buildCommand, stdout: primary.stdout, stderr: primary.stderr, exitCode: primary.exitCode, postBuildSteps, image });
  } finally { await rm(root, { recursive: true, force: true }); }
}
