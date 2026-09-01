import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateKiCadPath, validateKiCadDesign, type KiCadCommandResult } from "../src/kicad.js";

const ok = (args: string[], stdout = "9.0.9"): KiCadCommandResult => ({ command: ["kicad-cli", ...args], exitCode: 0, stdout, stderr: "" });

describe("KiCad integration adapter", () => {
  it("rejects absolute and escaping paths", () => {
    expect(() => validateKiCadPath("/tmp/design.kicad_pcb", "/workspace/kicad")).toThrow(/relative/);
    expect(() => validateKiCadPath("../outside.kicad_pcb", "/workspace/kicad")).toThrow(/escapes/);
    expect(() => validateKiCadPath("design.txt", "/workspace/kicad")).toThrow(/Unsupported/);
  });

  it("constructs real ERC, DRC, and netlist commands without shell interpolation", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-factory-kicad-"));
    await mkdir(join(root, "project"), { recursive: true });
    await writeFile(join(root, "project", "design.kicad_sch"), "(kicad_sch)");
    await writeFile(join(root, "project", "design.kicad_pcb"), "(kicad_pcb)");
    const calls: string[][] = [];
    try {
      const result = await validateKiCadDesign({ workspaceRoot: root, schematicPath: "project/design.kicad_sch", pcbPath: "project/design.kicad_pcb", exportNetlist: true, outputDirectory: join(root, "validation"), runner: async args => { calls.push(args); return ok(args); } });
      expect(result.schema).toBe("ai-factory.kicad-validation/v1");
      expect(calls[0]).toEqual(["version"]);
      expect(calls[1].slice(0, 4)).toEqual(["sch", "erc", "--format", "json"]);
      expect(calls[2].slice(0, 4)).toEqual(["pcb", "drc", "--format", "json"]);
      expect(calls[3].slice(0, 4)).toEqual(["sch", "export", "netlist", "--output"]);
      expect(calls.flat().some(value => value.includes("&&") || value.includes(";") || value.includes("|"))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.skipIf(process.env.KICAD_CLI_INTEGRATION !== "1")("runs against an installed KiCad CLI", async () => {
    const root = process.env.KICAD_INTEGRATION_WORKSPACE;
    if (!root) throw new Error("KICAD_INTEGRATION_WORKSPACE is required when KiCad integration is enabled.");
    const result = await validateKiCadDesign({ workspaceRoot: root, schematicPath: "fixtures/minimal.kicad_sch", pcbPath: "fixtures/minimal.kicad_pcb", exportNetlist: true });
    expect(result.tool).toBe("kicad-cli");
    expect(result.schematic?.exitCode).toBe(0);
    expect(result.pcb?.exitCode).toBe(0);
    expect(result.netlist?.exitCode).toBe(0);
  });
});
