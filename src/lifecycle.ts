import { z } from "zod";

export const StageName = z.enum(["requirements", "planning", "design", "simulation", "verification", "manufacturing", "physical_test", "iteration", "release"]);
export type StageName = z.infer<typeof StageName>;
export const StageStatus = z.enum(["pending", "ready", "running", "blocked", "passed", "failed", "skipped"]);
export type StageStatus = z.infer<typeof StageStatus>;
export const DEFAULT_STAGES: ReadonlyArray<{ name: StageName; order: number; requiresApproval: boolean }> = [
  { name: "requirements", order: 10, requiresApproval: false }, { name: "planning", order: 20, requiresApproval: false },
  { name: "design", order: 30, requiresApproval: false }, { name: "simulation", order: 40, requiresApproval: false },
  { name: "verification", order: 50, requiresApproval: false }, { name: "manufacturing", order: 60, requiresApproval: true },
  { name: "physical_test", order: 70, requiresApproval: true }, { name: "iteration", order: 80, requiresApproval: false },
  { name: "release", order: 90, requiresApproval: true }
];
export function nextStage(stages: Array<{ name: StageName; status: StageStatus; order: number }>) {
  return [...stages].sort((a, b) => a.order - b.order).find(stage => stage.status !== "passed" && stage.status !== "skipped")?.name ?? null;
}
export function canStartStage(stage: { name: StageName; status: StageStatus }, previous: { status: StageStatus } | undefined, requiresApproval: boolean, approvalGranted: boolean) {
  if (stage.status !== "pending" && stage.status !== "ready") return false;
  if (previous && previous.status !== "passed" && previous.status !== "skipped") return false;
  if (requiresApproval && !approvalGranted) return false;
  return true;
}
