import { execFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);
const ALLOWED_INPUT_EXTENSIONS = new Set([".kicad_pro", ".kicad_sch", ".kicad_pcb"]);
export type KiCadCommandResult = { command: string[]; exitCode: number; stdout: string; stderr: string };
export type KiCadRunner = (args: string[], cwd: string) => Promise<KiCadCommandResult>;
export type KiCadValidationResult = {
  schema: "ai-factory.kicad-validation/v1"; tool: "kicad-cli"; toolVersion: string; projectRoot: string;
  schematic?: { input: string; report: string; exitCode: number; violations: boolean };
  pcb?: { input: string; report: string; exitCode: number; violations: boolean };
  netlist?: { input: string; output: string; exitCode: number };
};

export function validateKiCadPath(inputPath: string, workspaceRoot = config.KICAD_WORKSPACE_ROOT): string {
  if (!inputPath || isAbsolute(inputPath)) throw new Error("KiCad paths must be relative to the configured workspace root.");
  const root = resolve(workspaceRoot), candidate = resolve(root, inputPath), rel = relative(root, candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("KiCad path escapes the configured workspace root.");
  if (!ALLOWED_INPUT_EXTENSIONS.has(extname(candidate).toLowerCase())) throw new Error("Unsupported KiCad input file type.");
  return candidate;
}

async function defaultRunner(args: string[], cwd: string): Promise<KiCadCommandResult> {
  try { const result = await execFileAsync(config.KICAD_CLI_PATH, args, { cwd, maxBuffer: 10 * 1024 * 1024 }); return { command: [config.KICAD_CLI_PATH, ...args], exitCode: 0, stdout: result.stdout, stderr: result.stderr }; }
  catch (error) { const failure = error as { code?: number | string; stdout?: string; stderr?: string; message?: string }; return { command: [config.KICAD_CLI_PATH, ...args], exitCode: typeof failure.code === "number" ? failure.code : 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message ?? "" }; }
}
async function requireFile(path: string): Promise<void> { const info = await stat(path).catch(() => undefined); if (!info?.isFile()) throw new Error(`KiCad input file does not exist: ${path}`); }
async function readReport(path: string): Promise<string> { return readFile(path, "utf8").catch(() => ""); }
export async function detectKiCadCli(runner: KiCadRunner = defaultRunner): Promise<string> { const result = await runner(["version"], resolve(config.KICAD_WORKSPACE_ROOT)); if (result.exitCode !== 0) throw new Error(`KiCad CLI is unavailable: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`); const version = `${result.stdout}\n${result.stderr}`.trim(); if (!version) throw new Error("KiCad CLI returned no version information."); return version.split(/\r?\n/)[0].trim(); }

export async function validateKiCadDesign(options: { schematicPath?: string; pcbPath?: string; exportNetlist?: boolean; workspaceRoot?: string; outputDirectory?: string; runner?: KiCadRunner }): Promise<KiCadValidationResult> {
  if (!options.schematicPath && !options.pcbPath) throw new Error("At least one schematicPath or pcbPath is required.");
  const workspaceRoot = resolve(options.workspaceRoot ?? config.KICAD_WORKSPACE_ROOT), runner = options.runner ?? defaultRunner;
  const toolVersion = await detectKiCadCli(runner), outputRoot = resolve(options.outputDirectory ?? resolve(workspaceRoot, ".ai-factory", "validation", new Date().toISOString().replace(/[:.]/g, "-")));
  const outputRel = relative(workspaceRoot, outputRoot); if (outputRel.startsWith("..") || isAbsolute(outputRel)) throw new Error("KiCad validation output escapes the configured workspace root."); await mkdir(outputRoot, { recursive: true });
  const result: KiCadValidationResult = { schema: "ai-factory.kicad-validation/v1", tool: "kicad-cli", toolVersion, projectRoot: workspaceRoot };
  if (options.schematicPath) {
    const input = validateKiCadPath(options.schematicPath, workspaceRoot); if (extname(input).toLowerCase() !== ".kicad_sch") throw new Error("schematicPath must point to a .kicad_sch file."); await requireFile(input);
    const report = resolve(outputRoot, "erc.json"), command = ["sch", "erc", "--format", "json", "--output", report, "--exit-code-violations", input]; const commandResult = await runner(command, dirname(input));
    result.schematic = { input, report, exitCode: commandResult.exitCode, violations: commandResult.exitCode === 5 }; if (commandResult.exitCode !== 0 && commandResult.exitCode !== 5) throw new Error(`KiCad schematic ERC failed: ${commandResult.stderr || commandResult.stdout || `exit ${commandResult.exitCode}`}`);
  }
  if (options.pcbPath) {
    const input = validateKiCadPath(options.pcbPath, workspaceRoot); if (extname(input).toLowerCase() !== ".kicad_pcb") throw new Error("pcbPath must point to a .kicad_pcb file."); await requireFile(input);
    const report = resolve(outputRoot, "drc.json"), command = ["pcb", "drc", "--format", "json", "--output", report, "--exit-code-violations", input]; const commandResult = await runner(command, dirname(input));
    result.pcb = { input, report, exitCode: commandResult.exitCode, violations: commandResult.exitCode === 5 }; if (commandResult.exitCode !== 0 && commandResult.exitCode !== 5) throw new Error(`KiCad PCB DRC failed: ${commandResult.stderr || commandResult.stdout || `exit ${commandResult.exitCode}`}`);
  }
  if (options.exportNetlist && options.schematicPath) {
    const input = validateKiCadPath(options.schematicPath, workspaceRoot), output = resolve(outputRoot, "netlist.net"), commandResult = await runner(["sch", "export", "netlist", "--output", output, input], dirname(input));
    result.netlist = { input, output, exitCode: commandResult.exitCode }; if (commandResult.exitCode !== 0) throw new Error(`KiCad netlist export failed: ${commandResult.stderr || commandResult.stdout || `exit ${commandResult.exitCode}`}`);
  }
  return result;
}
export async function readKiCadValidationReports(result: KiCadValidationResult): Promise<{ erc?: unknown; drc?: unknown }> { const parse = async (path?: string) => { if (!path) return undefined; const content = await readReport(path); if (!content) return undefined; try { return JSON.parse(content); } catch { return { raw: content }; } }; return { erc: await parse(result.schematic?.report), drc: await parse(result.pcb?.report) }; }
