# Architecture

AI Factory is a local-first control plane that separates **reasoning** from **deterministic execution** and preserves one persistent engineering thread from user intent to evidence.

## Runtime layers

```text
Natural-language request
        ↓
Factory API / operator console
        ↓
Requirements + engineering planner
        ↓
Bounded agent runtime
        ↓
Capability registry ──→ Fusion MCP / deterministic tools
        ↓
Project + cycle + run + artifact graph
        ↓
Lifecycle + approvals
        ↓
Simulation / manufacturing / physical test (future stages)
```

## Provider layer

All inference goes through the OpenAI SDK. The provider abstraction currently supports Ollama locally and an optional Fireworks endpoint. Normal factory operation is intended to remain local-first.

## Fusion layer

The application dynamically discovers the currently available Autodesk Fusion MCP tool set rather than hard-coding a fixed connector list. Deterministic factory capabilities are preferred over raw Fusion Python because they can validate inputs and emit measurable evidence.

## Agent loop

1. Create a durable run, optionally associated with a factory cycle.
2. Connect to Fusion MCP and discover tools.
3. Convert discovered tools and deterministic capabilities into model tools.
4. Send the task and engineering policy to the local model.
5. Execute returned tool calls through bounded deterministic connectors.
6. Persist model/tool events and evidence.
7. Stop on a final model response, successful deterministic evidence, or an execution budget.
8. Return a traceable run that can be inspected and retried.

## Factory cycle

A factory cycle is the durable unit for an end-to-end engineering attempt. It records the objective, constraints, status, timestamps, cycle events, and the runs produced during iterations. Cycle IDs are distinct from run IDs; cycle events therefore never masquerade as run events. This distinction is required for reliable orchestration, recovery, analytics, and future multi-stage execution.

## Persistence and migrations

SQLite is the local-first persistence engine. All application-owned tables are created by ordered migrations in `src/migrations.ts`, recorded in `schema_migrations`, and applied transactionally. A compatibility migration repairs legacy development databases that were created before the migration system was introduced.

Do not add `CREATE TABLE` calls to feature modules. Schema changes belong in a new numbered migration and must include migration coverage. This prevents the historical class of startup failures caused by a database claiming one schema while application code expects another.

## Evidence and safety

The model is never treated as verification. Deterministic tools, simulation, inspection, and physical tests must produce evidence linked to the relevant project artifacts and requirements. Manufacturing, physical testing, and release remain approval-gated until the corresponding authorization and interlock systems are engineered and validated.

## Future scale

SQLite remains appropriate for a local workstation. When the factory becomes multi-machine or multi-user, the persistence interface should be portable to PostgreSQL without changing agent/capability contracts. The same domain model should also support job scheduling, checkpoints, resource reservations, simulation farms, machine connectors, test infrastructure, and release manifests.
