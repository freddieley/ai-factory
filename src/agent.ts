import { config } from "./config.js";
import { addEvent, finishRun, createRun } from "./db.js";
import { fusion } from "./fusion.js";
import { getClient, providerInfo } from "./providers.js";

const SYSTEM = `
You are AI Factory, a disciplined engineering agent for civilian robotics and CAD work.

Your job is to help users design, analyze, document, and prepare benign engineering projects.
Prefer explicit assumptions, measurable requirements, and reversible CAD operations.

Rules:
- Inspect available tools before deciding how to act.
- Never claim a Fusion operation succeeded unless the tool result confirms it.
- If a tool fails, diagnose and retry only when the retry is materially different.
- Keep an auditable sequence of actions.
- Do not dispatch physical machinery or irreversible manufacturing jobs without an explicit human approval step.
- For physical fabrication, produce a manufacturing proposal/approval request rather than silently starting a machine.
- Focus on civilian applications such as educational robots, inspection, environmental monitoring, automation, and research.
`;

function mcpToolsAsOpenAI() {
  return fusion.getTools().map((tool) => ({
    type: "function" as const,
    function: {
      name: `fusion__${tool.name}`,
      description: tool.description ?? `Autodesk Fusion tool: ${tool.name}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  }));
}

function unwrapMcpResult(result: unknown) {
  return JSON.stringify(result);
}

export async function runAgent(projectId: string, prompt: string) {
  const info = providerInfo();
  const client = getClient();
  const runId = createRun(projectId, prompt, info.provider, info.model);

  try {
    try {
      await fusion.connect();
      await fusion.refresh();
      addEvent(runId, "fusion.connected", { tools: fusion.getTools().map(t => t.name) });
    } catch (error) {
      addEvent(runId, "fusion.unavailable", { error: String(error) });
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Project ID: ${projectId}\n\nUser request:\n${prompt}`
      }
    ];

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
      addEvent(runId, "model.message", {
        step,
        content: message.content ?? null,
        toolCalls: message.tool_calls?.map(tc => tc.function.name) ?? []
      });

      if (!message.tool_calls?.length) {
        const output = message.content ?? "";
        finishRun(runId, "completed", output);
        return { runId, output, provider: info };
      }

      for (const call of message.tool_calls) {
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
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        addEvent(runId, "tool.call", { step, toolName, args });

        try {
          const result = await fusion.callTool(toolName, args);
          const content = unwrapMcpResult(result);
          addEvent(runId, "tool.result", { step, toolName, result });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content
          });
        } catch (error) {
          const content = JSON.stringify({ error: String(error), toolName });
          addEvent(runId, "tool.error", { step, toolName, error: String(error) });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content
          });
        }
      }
    }

    const output = "Agent stopped after reaching MAX_AGENT_STEPS. Review the run events before continuing.";
    finishRun(runId, "max_steps", output);
    return { runId, output, provider: info };
  } catch (error) {
    const output = `Agent failed: ${String(error)}`;
    finishRun(runId, "failed", output);
    return { runId, output, provider: info };
  }
}
