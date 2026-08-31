import OpenAI from "openai";
import { config } from "./config.js";
import { addEvent, finishRun, createRun, requestApproval } from "./db.js";
import { fusion } from "./fusion.js";
import { getClient, providerInfo } from "./providers.js";
import { createEngineeringPlan } from "./planner.js";
import { evaluateFusionOperation } from "./policy.js";
import { savePlan } from "./engineering-db.js";

const SYSTEM = `You are AI Factory, a disciplined engineering agent for civilian robotics and CAD work.
Use the supplied engineering plan as the source of truth for the current task.
Inspect Fusion before modifying it. Prefer small, reversible operations. After every modification, inspect the resulting state and verify the requested outcome.
Never claim success without tool evidence. Physical manufacturing or machine execution is never silently authorized: it must become an approval request.
When the requested evidence is sufficient, stop calling tools and write the final report. Do not repeat an identical read operation merely to fill the step budget.
If Fusion reports that there is no active document, treat that as a valid inspection result unless the user's request explicitly requires an open document.
`;

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function mcpToolsAsOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return fusion.getTools().map((tool) => ({
    type: "function",
    function: {
      name: `fusion__${tool.name}`,
      description: tool.description ?? `Autodesk Fusion tool: ${tool.name}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  }));
}

function getFunctionToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
): ToolCall[] {
  return (toolCalls ?? []).filter(
    (call): call is ToolCall =>
      call.type === "function" &&
      "function" in call &&
      typeof call.function?.name === "string"
  );
}

function toolFingerprint(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${JSON.stringify(args, Object.keys(args).sort())}`;
}

function shouldForceFinalization(
  recentFingerprints: string[],
  currentFingerprint: string
): boolean {
  const recent = recentFingerprints.slice(-2);
  return recent.length === 2 && recent.every((fingerprint) => fingerprint === currentFingerprint);
}

async function finalize(
  client: OpenAI,
  info: ReturnType<typeof providerInfo>,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  runId: string,
  reason: string
): Promise<string> {
  addEvent(runId, "agent.finalizing", { reason });

  const response = await client.chat.completions.create({
    model: info.model,
    temperature: 0,
    messages: [
      ...messages,
      {
        role: "system",
        content:
          "Produce the final engineering report now. Do not request any more tools. Summarize only evidence present in the conversation. Clearly distinguish observed facts, assumptions, and anything not verified."
      }
    ],
    tool_choice: "none"
  });

  return response.choices[0]?.message?.content ?? "No final report was produced.";
}

export async function runAgent(projectId: string, prompt: string) {
  const info = providerInfo();
  const client = getClient();
  const runId = createRun(projectId, prompt, info.provider, info.model);

  try {
    try {
      await fusion.connect();
      await fusion.refresh();
      addEvent(runId, "fusion.connected", {
        tools: fusion.getTools().map((tool) => tool.name)
      });
    } catch (error) {
      addEvent(runId, "fusion.unavailable", { error: String(error) });
    }

    const plan = await createEngineeringPlan(projectId, prompt, runId);
    savePlan(projectId, plan);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Project ID: ${projectId}\nEngineering plan:\n${JSON.stringify(plan, null, 2)}\n\nUser request:\n${prompt}`
      }
    ];

    const recentFingerprints: string[] = [];

    for (let step = 1; step <= config.MAX_AGENT_STEPS; step++) {
      const response = await client.chat.completions.create({
        model: info.model,
        temperature: config.TEMPERATURE,
        messages,
        tools: mcpToolsAsOpenAI(),
        tool_choice: "auto"
      });

      const message = response.choices[0]?.message;
      if (!message) throw new Error("Model returned no message.");

      messages.push(message);

      const calls = getFunctionToolCalls(message.tool_calls);
      addEvent(runId, "model.message", {
        step,
        content: message.content ?? null,
        toolCalls: calls.map((call) => call.function.name)
      });

      if (calls.length === 0) {
        const output = message.content ?? "";
        finishRun(runId, "completed", output);
        return { runId, output, plan, provider: info };
      }

      for (const call of calls) {
        const rawName = call.function.name;
        if (!rawName.startsWith("fusion__")) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "Unknown tool namespace." })
          });
          continue;
        }

        const toolName = rawName.slice("fusion__".length);
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }

        const fingerprint = toolFingerprint(toolName, args);
        if (shouldForceFinalization(recentFingerprints, fingerprint)) {
          const output = await finalize(
            client,
            info,
            messages,
            runId,
            `repeated tool request: ${toolName}`
          );
          finishRun(runId, "completed", output);
          return { runId, output, plan, provider: info };
        }
        recentFingerprints.push(fingerprint);

        const policy = evaluateFusionOperation(toolName, args);
        addEvent(runId, "tool.policy", { step, toolName, args, policy });

        if (!policy.allowed) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: policy.reason })
          });
          continue;
        }

        if (policy.requiresApproval) {
          const approvalId = requestApproval(projectId, toolName, {
            runId,
            toolName,
            args,
            reason: policy.reason
          });
          addEvent(runId, "approval.requested", {
            approvalId,
            toolName,
            args,
            reason: policy.reason
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              status: "blocked_pending_approval",
              approvalId,
              reason: policy.reason
            })
          });
          continue;
        }

        addEvent(runId, "tool.call", { step, toolName, args });
        try {
          const result = await fusion.callTool(toolName, args);
          addEvent(runId, "tool.result", { step, toolName, result });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result)
          });
        } catch (error) {
          addEvent(runId, "tool.error", {
            step,
            toolName,
            error: String(error)
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: String(error), toolName })
          });
        }
      }
    }

    const output = await finalize(
      client,
      info,
      messages,
      runId,
      "maximum agent step budget reached"
    );
    finishRun(runId, "completed", output);
    return { runId, output, plan, provider: info };
  } catch (error) {
    const output = `Agent failed: ${String(error)}`;
    finishRun(runId, "failed", output);
    return { runId, output, provider: info };
  }
}
