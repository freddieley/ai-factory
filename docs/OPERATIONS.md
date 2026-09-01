# Operations Guide

## Standard verification

From a clean checkout:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run doctor
```

`npm ci` is the reproducible installation path and uses `package-lock.json`. CI runs the same install and build/test gates and performs a high-severity dependency audit.

## Local runtime

1. Copy `.env.example` to `.env`.
2. Start Ollama and ensure the configured model is available.
3. Start Fusion 360 when CAD operations are required.
4. Enable Fusion's local MCP server.
5. Run `npm run doctor`.
6. Start the API with `npm run dev`.

The default API bind is `127.0.0.1:3000`.

## Database migrations

The application automatically creates and upgrades its SQLite database at startup. Migrations are ordered and recorded in `schema_migrations`.

To inspect the current version, use the database diagnostics exposed by the application or `npm run doctor`.

Never delete or edit a migration that has already shipped. Add a higher-numbered migration for every schema change. Migration code must be idempotent where it repairs legacy state and must be covered by tests.

If a development database was created by an older build and is missing columns such as `requirements.source`, `requirements.key`, `artifacts.parent_artifact_id`, or `artifacts.created_at`, restart the application so the compatibility migration can repair it before queries execute.

## Factory-cycle observability

A factory cycle is the parent identity for an end-to-end attempt. Agent runs belong to a cycle, and cycle events are separate from run events. Use the cycle endpoints to inspect the complete attempt without conflating cycle-level orchestration events with model/tool execution.

Useful endpoints:

- `GET /api/health`
- `GET /api/capabilities`
- `GET /api/projects/:id/cycles`
- `GET /api/cycles/:id`
- `GET /api/cycles/:id/events`
- `GET /api/runs/:id`
- `GET /api/runs/:id/events`
- `GET /api/projects/:id/artifacts`

## Failure handling

The factory is intentionally bounded. Model calls, tool calls, wall-clock time, and iteration count have configurable limits. A failed or budget-exhausted operation should be inspected through its persisted events rather than retried blindly.

A model assertion is not evidence. Successful engineering claims should point to deterministic tool output, simulation results, inspection measurements, or physical-test evidence.

## Fusion troubleshooting

If `npm run doctor` reports Fusion MCP failure:

- confirm Fusion 360 is running;
- confirm the local MCP server is enabled;
- confirm `FUSION_MCP_URL` matches the local endpoint;
- run the doctor again before starting an autonomous cycle.

If deterministic CAD validation fails, preserve the run and tool result. Do not manually change dimensions merely to make the validation pass; fix the engineering request or deterministic capability instead.

## Safety boundary

Do not expose the local API or machine connectors to an untrusted network. Physical manufacturing and testing remain approval-gated. Future machine connectors must implement authorization, preconditions, health checks, cancellation, interlocks, monitoring, and emergency-stop integration before autonomous physical execution is enabled.
