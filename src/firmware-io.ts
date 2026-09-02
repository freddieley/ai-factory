import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { FirmwareProject } from "./firmware.js";

const execFileAsync = promisify(execFile);
export const FirmwareTelemetryEvent = z.object({ schema: z.literal("ai-factory.firmware-telemetry/v1"), type: z.enum(["heartbeat"]), sequence: z.number().int().nonnegative() });
export type FirmwareTelemetryEvent = z.infer<typeof FirmwareTelemetryEvent>;
export const FirmwareHilResult = z.object({ schema: z.literal("ai-factory.firmware-hil/v1"), status: z.enum(["pass", "fail"]), events: z.array(FirmwareTelemetryEvent), stdout: z.string(), stderr: z.string(), exitCode: z.number().int().nonnegative() });
export type FirmwareHilResult = z.infer<typeof FirmwareHilResult>;
export const FirmwareFlashRequest = z.object({ tool: z.enum(["avrdude", "dfu-util", "openocd"]), artifactPath: z.string().min(1), device: z.string().min(1), execute: z.boolean().default(false) });
export type FirmwareFlashRequest = z.infer<typeof FirmwareFlashRequest>;
export const FirmwareFlashPlan = z.object({ schema: z.literal("ai-factory.firmware-flash-plan/v1"), tool: FirmwareFlashRequest.shape.tool, command: z.array(z.string().min(1)), executable: z.string().min(1), requiresExplicitExecution: z.literal(true) });
export type FirmwareFlashPlan = z.infer<typeof FirmwareFlashPlan>;

export function parseFirmwareTelemetry(line: string): FirmwareTelemetryEvent | null { const match = line.trim().match(/^AI_FACTORY_HEARTBEAT\s+(\d+)$/); return match ? FirmwareTelemetryEvent.parse({ schema: "ai-factory.firmware-telemetry/v1", type: "heartbeat", sequence: Number(match[1]) }) : null; }
export function planFirmwareFlash(input: unknown): FirmwareFlashPlan {
  const request = FirmwareFlashRequest.parse(input);
  const command = request.tool === "avrdude" ? ["avrdude", "-p", request.device, "-U", `flash:w:${request.artifactPath}:i`] : request.tool === "dfu-util" ? ["dfu-util", "-d", request.device, "-D", request.artifactPath] : ["openocd", "-f", request.device, "-c", `program ${request.artifactPath} verify reset exit`];
  if (request.execute) throw new Error("Physical flashing requires a dedicated authorized hardware execution adapter; command planning does not execute hardware writes.");
  return FirmwareFlashPlan.parse({ schema: "ai-factory.firmware-flash-plan/v1", tool: request.tool, command, executable: command[0], requiresExplicitExecution: true });
}

export async function runFirmwareHil(projectInput: unknown): Promise<FirmwareHilResult> {
  const project = FirmwareProject.parse(projectInput); if (project.target.toolchain !== "host-g++") throw new Error(`Unsupported HIL toolchain: ${project.target.toolchain}`);
  const root = await mkdtemp(join(tmpdir(), "ai-factory-firmware-hil-"));
  try {
    for (const file of project.files) { const destination = join(root, file.path); await mkdir(join(destination, ".."), { recursive: true }); await writeFile(destination, file.content, "utf8"); }
    const binary = join(root, "firmware-test");
    try { await execFileAsync(project.buildCommand[0], project.buildCommand.slice(1), { cwd: root, maxBuffer: 1024 * 1024 }); const { stdout, stderr } = await execFileAsync(binary, [], { cwd: root, maxBuffer: 1024 * 1024 }); const events = stdout.split(/\r?\n/).map(parseFirmwareTelemetry).filter((event): event is FirmwareTelemetryEvent => event !== null); return FirmwareHilResult.parse({ schema: "ai-factory.firmware-hil/v1", status: events.length > 0 ? "pass" : "fail", events, stdout, stderr, exitCode: 0 }); }
    catch (error) { const failure = error as { stdout?: string; stderr?: string; code?: number }; return FirmwareHilResult.parse({ schema: "ai-factory.firmware-hil/v1", status: "fail", events: (failure.stdout ?? "").split(/\r?\n/).map(parseFirmwareTelemetry).filter((event): event is FirmwareTelemetryEvent => event !== null), stdout: failure.stdout ?? "", stderr: failure.stderr ?? String(error), exitCode: typeof failure.code === "number" ? failure.code : 1 }); }
  } finally { await rm(root, { recursive: true, force: true }); }
}
