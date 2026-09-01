import OpenAI from "openai";
import { executeCreateBox, executeCreateCylinder, executeCreateMountingPlate, executeCreateEnclosure } from "./cad.js";
import { executeCreatePlate } from "./plate.js";
import { createParametricBox } from "./parametric.js";

export type CapabilityDomain = "cad" | "electronics" | "mechanics" | "simulation" | "software" | "testing" | "manufacturing";
export type Capability = { name: string; domain: CapabilityDomain; description: string; parameters: Record<string, unknown>; execute: (args: Record<string, unknown>) => Promise<unknown> };

const number = { type: "number" };
export const capabilities: Capability[] = [
  { name: "ai_factory_create_box", domain: "cad", description: "Create and verify a rectangular solid.", parameters: { type: "object", properties: { widthMm: number, depthMm: number, heightMm: number }, required: ["widthMm", "depthMm", "heightMm"] }, execute: executeCreateBox },
  { name: "ai_factory_create_cylinder", domain: "cad", description: "Create and verify a cylindrical solid.", parameters: { type: "object", properties: { radiusMm: number, heightMm: number }, required: ["radiusMm", "heightMm"] }, execute: executeCreateCylinder },
  { name: "ai_factory_create_plate", domain: "cad", description: "Create and verify a rectangular plate with a through-hole.", parameters: { type: "object", properties: { widthMm: number, depthMm: number, heightMm: number, holeDiameterMm: number, holeXmm: number, holeYmm: number }, required: ["widthMm", "depthMm", "heightMm", "holeDiameterMm"] }, execute: executeCreatePlate },
  { name: "ai_factory_create_mounting_plate", domain: "cad", description: "Create and verify a rectangular mounting plate with four posts.", parameters: { type: "object", properties: { widthMm: number, depthMm: number, plateHeightMm: number, postRadiusMm: number, postHeightMm: number, insetMm: number }, required: ["widthMm", "depthMm", "plateHeightMm", "postRadiusMm", "postHeightMm", "insetMm"] }, execute: executeCreateMountingPlate },
  { name: "ai_factory_create_enclosure", domain: "cad", description: "Create and verify an open-top electronics enclosure.", parameters: { type: "object", properties: { widthMm: number, depthMm: number, baseHeightMm: number, wallHeightMm: number, wallThicknessMm: number }, required: ["widthMm", "depthMm", "baseHeightMm", "wallHeightMm", "wallThicknessMm"] }, execute: executeCreateEnclosure },
  { name: "ai_factory_plan_parametric_box", domain: "mechanics", description: "Create a vendor-neutral, validated parametric mechanical box definition without executing CAD or manufacturing.", parameters: { type: "object", properties: { name: { type: "string" }, widthMm: number, depthMm: number, heightMm: number }, required: ["name", "widthMm", "depthMm", "heightMm"] }, execute: async (args) => createParametricBox(String(args.name), Number(args.widthMm), Number(args.depthMm), Number(args.heightMm)) }
];

export const getCapability = (name: string) => capabilities.find((c) => c.name === name);
export const listCapabilities = (domain?: CapabilityDomain) => domain ? capabilities.filter((c) => c.domain === domain) : [...capabilities];
export const toOpenAITools = (): OpenAI.Chat.Completions.ChatCompletionTool[] => capabilities.map((c) => ({ type: "function" as const, function: { name: c.name, description: c.description, parameters: c.parameters } }));
export async function executeCapability(name: string, args: Record<string, unknown>) { const capability = getCapability(name); if (!capability) throw new Error(`Unknown factory capability: ${name}`); return capability.execute(args); }
