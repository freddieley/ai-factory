# AI Factory v1

A local-first AI engineering control plane for civilian robotics, CAD, manufacturing planning, verification, and factory operations.

## What v1 does

- Runs against a local model through Ollama or a cloud model through Fireworks.
- Uses OpenAI-compatible APIs so the model provider is configurable.
- Connects to Autodesk Fusion's official local MCP server.
- Dynamically discovers Fusion MCP tools.
- Gives the model those tools through standard tool calling.
- Executes tool calls in a bounded agent loop.
- Stores projects, engineering runs, decisions, and verification records in SQLite.
- Provides a small browser console and JSON API.
- Includes a safety gate: physical manufacturing actions are represented as approval-required operations rather than silently dispatched to machines.

## Architecture

```text
Browser
   |
   v
Fastify API
   |
   +--> Project/Run database
   |
   +--> AI provider adapter
   |       +--> Ollama (local)
   |       `--> Fireworks (cloud)
   |
   `--> Fusion MCP client
             |
             `--> Autodesk Fusion 360
```

Autodesk Fusion's local MCP server must be enabled inside Fusion under Preferences > General > API. The default endpoint is `http://127.0.0.1:27182/mcp`.

## Recommended local model for a 12 GB RTX 5070

Start with:

```bash
ollama pull qwen3.5:9b-q4_K_M
```

It is small enough to leave VRAM headroom while still providing a modern multimodal/tool-capable model.

For higher quality, switch `.env` to Fireworks and use a current reasoning/agent model.

## Install

```bash
npm install
cp .env.example .env
```

Then run the diagnostics:

```bash
npm run doctor
```

Start:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## Fusion setup

1. Install and launch Fusion 360 desktop.
2. Open Preferences.
3. Go to General > API.
4. Enable the Fusion MCP Server.
5. Leave Fusion running.
6. Run `npm run doctor`.
7. The console should report the MCP endpoint and discovered tools.

The app does not assume a fixed Fusion tool list. It asks the MCP server for the current tools at connection time.

## Provider switching

Local:

```env
AI_PROVIDER=local
LOCAL_MODEL=qwen3.5:9b-q4_K_M
```

Cloud:

```env
AI_PROVIDER=fireworks
FIREWORKS_API_KEY=...
FIREWORKS_MODEL=accounts/fireworks/models/glm-5p2
```

The rest of the application stays unchanged.

## Example task

> Create a new Fusion design for a simple electronics enclosure. Start with a 100 mm x 60 mm x 30 mm base and explain each modeling step before executing it.

The agent can inspect available Fusion tools and use them through MCP. It is intentionally configured to require explicit user approval for manufacturing dispatch.

## Important scope

This project is intended for benign engineering and civilian robotics applications such as educational robots, inspection platforms, environmental monitoring, automation, and research hardware. Keep human approval in the loop before physical fabrication or machine execution.

## v1 roadmap

- [x] Model-provider abstraction
- [x] Local/cloud configuration
- [x] Fusion MCP discovery
- [x] Tool-call agent loop
- [x] Project persistence
- [x] Verification records
- [x] Browser console
- [ ] Rich CAD state snapshots
- [ ] CAD revision graph
- [ ] Supplier/component database
- [ ] CAM planning
- [ ] Machine connectors
- [ ] Vision-based inspection
- [ ] Closed-loop test data
