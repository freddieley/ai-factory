import { performance } from "node:perf_hooks";

export type ExecutionBudget = { maxModelCalls: number; maxToolCalls: number; maxWallMs: number };
export const DEFAULT_EXECUTION_BUDGET: ExecutionBudget = { maxModelCalls: 4, maxToolCalls: 30, maxWallMs: 120_000 };

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export class ExecutionController {
  readonly startedAt = performance.now();
  modelCalls = 0;
  toolCalls = 0;
  private readonly fingerprints = new Set<string>();
  constructor(private readonly budget: ExecutionBudget = DEFAULT_EXECUTION_BUDGET) {}
  elapsedMs() { return Math.round(performance.now() - this.startedAt); }
  canModelCall() { return this.modelCalls < this.budget.maxModelCalls && this.elapsedMs() < this.budget.maxWallMs; }
  canToolCall() { return this.toolCalls < this.budget.maxToolCalls && this.elapsedMs() < this.budget.maxWallMs; }
  recordModelCall() { this.modelCalls += 1; }
  recordToolCall() { this.toolCalls += 1; }
  isRepeated(toolName: string, args: Record<string, unknown>) {
    const fingerprint = `${toolName}:${JSON.stringify(stable(args))}`;
    if (this.fingerprints.has(fingerprint)) return true;
    this.fingerprints.add(fingerprint);
    return false;
  }
  summary() { return { modelCalls: this.modelCalls, toolCalls: this.toolCalls, elapsedMs: this.elapsedMs(), budget: this.budget }; }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export function withAbortTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    operation(controller.signal).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
