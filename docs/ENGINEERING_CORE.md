# Engineering Core v1.2

AI Factory separates engineering intent from CAD execution.

## Flow

1. Create a run.
2. Inspect the available Fusion MCP tools.
3. Generate and record an engineering plan.
4. Give the plan to the CAD agent as the source of truth.
5. Evaluate every Fusion tool call through policy.
6. Execute permitted CAD actions and audit the result.
7. Manufacturing actions become approval requests instead of silently executing.
8. Future iterations will add explicit read-back verification and automatic replanning.

## Persistent entities

- Requirements: typed engineering constraints and verification status.
- Plans: objective, assumptions, requirements, ordered operations, and expected verification.
- Fusion links: maps an AI Factory project to Autodesk hub/project/design identifiers.
- Verification records: evidence associated with a requirement and run.

## Safety boundary

`manufacture` is a distinct operation class. Anything that appears to dispatch or start physical manufacturing requires an explicit human approval record. v1.2 does not provide a machine connector or automatic approval path.

## Local-first inference

The agent continues to use the configured provider, with Ollama/Qwen as the default local path and Fireworks available through the existing provider abstraction.
