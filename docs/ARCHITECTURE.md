# Architecture

## Provider layer

All inference goes through the OpenAI SDK. This gives the application one tool-calling interface while allowing:

- Ollama locally
- Fireworks remotely
- future OpenAI-compatible providers

## Fusion layer

The application does not hard-code Fusion commands. It connects to Autodesk's official local MCP server and dynamically discovers its current tools.

That makes the application resilient to Autodesk adding or changing MCP capabilities.

## Agent loop

1. Connect to Fusion MCP.
2. Discover tools.
3. Convert MCP tools into OpenAI function tools.
4. Send task + system policy to the model.
5. Execute returned tool calls.
6. Return results to the model.
7. Repeat until the model produces a final answer or the step budget is reached.
8. Persist every important event.

## Human approval

The first version intentionally stops short of arbitrary machine control. A later factory connector can consume approved jobs from the approval table.

## Future database migration

SQLite is deliberate for local-first v1. Once multi-user or multi-machine operation matters, move the persistence layer to PostgreSQL without changing the agent or Fusion interfaces.
