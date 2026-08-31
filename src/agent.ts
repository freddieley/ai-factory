import OpenAI from "openai";
import { config } from "./config.js";
import { addEvent, finishRun, createRun } from "./db.js";
import { fusion } from "./fusion.js";
import { getClient, providerInfo } from "./providers.js";

const SYSTEM = `
You are AI Factory, a disciplined engineering agent for civilian robotics and CAD work.

Your job is to help users design, analyze, document, and prepare benign engineering projects.

Prefer:
- explicit assumptions
- measurable requirements
- reversible CAD operations
- verification after important operations
- concise explanations

Rules:
- Inspect available Fusion tools before deciding how to act.
- Never claim a Fusion operation succeeded unless the tool result confirms it.
- If a tool fails, diagnose the failure before retrying.
- Keep an auditable sequence of actions.
- Never dispatch physical machinery or irreversible manufacturing jobs without explicit human approval.
- For physical fabrication, produce a manufacturing proposal/approval request rather than silently starting a machine.
- Focus on civilian applications such as educational robots, inspection, environmental monitoring, automation, and research.
`;

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

function mcpToolsAsOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return fusion.getTools().map((tool) => ({
    type: "function",
    function: {
      name: `fusion__${tool.name}`,
      description:
        tool.description ?? `Autodesk Fusion tool: ${tool.name}`,
      parameters:
        tool.inputSchema ?? {
          type: "object",
          properties: {}
        }
    }
  }));
}

function getFunctionToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined
): ToolCall[] {
  if (!toolCalls) return [];

  return toolCalls.filter(
    (call): call is ToolCall =>
      call.type === "function" &&
      "function" in call &&
      typeof call.function?.name === "string"
  );
}

function unwrapMcpResult(result: unknown): string {
  return JSON.stringify(result);
}

export async function runAgent(
  projectId: string,
  prompt: string
) {
  const info = providerInfo();
  const client = getClient();

  const runId = createRun(
    projectId,
    prompt,
    info.provider,
    info.model
  );

  try {
    /*
     * Connect to Fusion and dynamically discover its
     * currently available MCP tools.
     */
    try {
      await fusion.connect();
      await fusion.refresh();

      addEvent(runId, "fusion.connected", {
        tools: fusion.getTools().map((tool) => tool.name)
      });
    } catch (error) {
      addEvent(runId, "fusion.unavailable", {
        error: String(error)
      });
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: SYSTEM
      },
      {
        role: "user",
        content: `Project ID: ${projectId}\n\nUser request:\n${prompt}`
      }
    ];

    for (
      let step = 1;
      step <= config.MAX_AGENT_STEPS;
      step++
    ) {
      const response = await client.chat.completions.create({
        model: info.model,
        temperature: config.TEMPERATURE,
        messages,
        tools: mcpToolsAsOpenAI(),
        tool_choice: "auto"
      });

      const message = response.choices[0]?.message;

      if (!message) {
        throw new Error("Model returned no message.");
      }

      messages.push(message);

      const functionToolCalls = getFunctionToolCalls(
        message.tool_calls
      );

      addEvent(runId, "model.message", {
        step,
        content: message.content ?? null,
        toolCalls: functionToolCalls.map(
          (call) => call.function.name
        )
      });

      /*
       * No function calls means the model has finished
       * reasoning and produced its final response.
       */
      if (functionToolCalls.length === 0) {
        const output = message.content ?? "";

        finishRun(
          runId,
          "completed",
          output
        );

        return {
          runId,
          output,
          provider: info
        };
      }

      /*
       * Execute each requested Fusion operation.
       */
      for (const call of functionToolCalls) {
        const rawName = call.function.name;

        if (!rawName.startsWith("fusion__")) {
          const content = JSON.stringify({
            error: "Unknown tool namespace."
          });

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content
          });

          continue;
        }

        const toolName = rawName.slice("fusion__".length);

        let args: Record<string, unknown>;

        try {
          args = JSON.parse(
            call.function.arguments || "{}"
          ) as Record<string, unknown>;
        } catch {
          args = {};
        }

        addEvent(runId, "tool.call", {
          step,
          toolName,
          args
        });

        try {
          const result = await fusion.callTool(
            toolName,
            args
          );

          const content = unwrapMcpResult(result);

          addEvent(runId, "tool.result", {
            step,
            toolName,
            result
          });

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content
          });
        } catch (error) {
          const content = JSON.stringify({
            error: String(error),
            toolName
          });

          addEvent(runId, "tool.error", {
            step,
            toolName,
            error: String(error)
          });

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content
          });
        }
      }
    }

    const output =
      "Agent stopped after reaching MAX_AGENT_STEPS. Review the run events before continuing.";

    finishRun(
      runId,
      "max_steps",
      output
    );

    return {
      runId,
      output,
      provider: info
    };
  } catch (error) {
    const output = `Agent failed: ${String(error)}`;

    finishRun(
      runId,
      "failed",
      output
    );

    return {
      runId,
      output,
      provider: info
    };
  }
}