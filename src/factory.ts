import { z } from "zod";
import { runAgent } from "./agent.js";
import { addEvent, createRun } from "./db.js";
import { providerInfo } from "./providers.js";

export const FactoryRequest = z.object({
  projectId: z.string().min(1),
  objective: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  maxIterations: z.number().int().min(1).max(5).default(2)
});

export type FactoryRequest = z.infer<typeof FactoryRequest>;

export async function runFactory(request: FactoryRequest) {
  const normalized = FactoryRequest.parse(request);
  const cycleId = createRun(normalized.projectId, `factory:${normalized.objective}`, providerInfo().provider, providerInfo().model);
  const results: unknown[] = [];

  addEvent(cycleId, "factory.cycle.started", {
    objective: normalized.objective,
    constraints: normalized.constraints,
    maxIterations: normalized.maxIterations
  });

  for (let iteration = 1; iteration <= normalized.maxIterations; iteration++) {
    const verificationPrompt = iteration === 1
      ? `Act as the CAD engineering executor. Build the requested design in Fusion if appropriate. Objective: ${normalized.objective}\nConstraints:\n${normalized.constraints.join("\n") || "None specified"}\nFirst inspect the current document. Make only the CAD changes needed for the objective. After each modification inspect the resulting state. Do not manufacture or dispatch anything.`
      : `Iteration ${iteration} of a CAD engineering loop. Re-open the current Fusion state, inspect the existing design against this objective, identify any unmet requirements, and make only necessary CAD corrections. Verify the resulting state with Fusion evidence. Objective: ${normalized.objective}\nConstraints:\n${normalized.constraints.join("\n") || "None specified"}\nDo not manufacture or dispatch anything.`;

    addEvent(cycleId, "factory.iteration.started", { iteration });
    const result = await runAgent(normalized.projectId, verificationPrompt);
    results.push({ iteration, result });
    addEvent(cycleId, "factory.iteration.completed", {
      iteration,
      runId: result.runId,
      output: result.output
    });

    if (!/not verified|unable to|failed|error|unmet|cannot/i.test(result.output)) {
      addEvent(cycleId, "factory.cycle.completed", { iteration, reason: "Agent produced no explicit unresolved condition." });
      return { cycleId, status: "completed", iterations: results };
    }
  }

  addEvent(cycleId, "factory.cycle.completed", { reason: "Iteration budget exhausted; review evidence." });
  return { cycleId, status: "needs_review", iterations: results };
}
