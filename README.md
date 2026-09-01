# AI Factory

A local-first AI engineering control plane for civilian robotics: **plain-language request → requirements → engineering plan → CAD → simulation → verification → manufacturing → physical testing → autonomous iteration → release**.

The repository is deliberately being built as a staged autonomy stack. The current system can plan and execute bounded CAD workflows, persist engineering state, and keep consequential physical operations behind explicit approval. The long-term target is a locally operated research-and-development factory capable of taking a sufficiently specified product request and coordinating the software, hardware, simulation, manufacturing, testing, and iteration required to produce a real-world robot or drone.

See **[GOAL.md](./GOAL.md)** for the complete end-state specification and design principles. Treat the roadmap below as the canonical development queue: when continuing development, finish the current phase completely—including implementation, tests, documentation, migrations, diagnostics, and CI—before moving forward.

## Current architecture

```text
User prompt
    ↓
Factory API / Console
    ↓
Requirements + Engineering Plan
    ↓
Bounded Agent Runtime
    ↓
Capability Registry ──→ Fusion MCP / deterministic engineering tools
    ↓
Persistent Project + Product / Cycle / Artifact Graph
    ↓
Lifecycle State Machine
    ↓
Simulation → Manufacturing → Physical Test → Iteration
                         ↑              │
                         └──────────────┘
```

### Current capabilities

- Local-first model provider through an OpenAI-compatible API (Ollama) with optional Fireworks fallback.
- Structured engineering planning from plain-language objectives.
- Zod-validated requirements and engineering plans.
- Bounded model/tool execution budgets and timeouts.
- Dynamic Autodesk Fusion MCP capability discovery.
- Deterministic CAD primitives and verification evidence.
- Versioned SQLite migrations with legacy-schema repair and migration tests.
- Persistent projects, runs, factory cycles, events, requirements, artifacts, lineage, approvals, plans, work orders, and lifecycle stages.
- First-class cycle/run/event lineage with cycle and run APIs.
- Approval gates for manufacturing, physical testing, and release.
- Browser console, JSON API, structured Fastify request logging, diagnostics, reproducible npm installs, CI quality checks, and automated contract tests.

## Local development

```bash
npm ci
cp .env.example .env
npm run verify
npm run doctor
npm run dev
```

`npm run verify` runs typechecking, tests, a production build, and the high-severity dependency audit. The server defaults to `http://127.0.0.1:3000`.

### Local model

The recommended development configuration uses Ollama. Pull the configured model before running the factory:

```bash
ollama pull qwen3.5:9b-q4_K_M
```

The model is replaceable through `.env`; the factory's planning and execution contracts are provider-independent.

### Fusion

1. Install and launch Fusion 360 desktop.
2. Open **Preferences → General → API**.
3. Enable the Fusion MCP Server.
4. Leave Fusion running.
5. Run `npm run doctor`.

The integration discovers the MCP tool set at runtime instead of assuming a fixed list.

See [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) for database migration, troubleshooting, observability, and local-operation procedures.

## Safety boundary

This project targets benign civilian engineering and robotics. Autonomous software must not silently initiate irreversible physical operations. Manufacturing, physical testing, and release remain approval-gated until the factory has an appropriate authorization, interlock, monitoring, and emergency-stop architecture. Simulation and deterministic verification should precede physical execution whenever practical.

## Canonical roadmap

### Phase 0 — Foundation hardening **[complete]**
- [x] Local/cloud provider abstraction and configuration.
- [x] Dynamic Fusion MCP discovery.
- [x] Bounded tool-calling agent runtime.
- [x] Persistent projects, runs, events, requirements, artifacts, lineage, approvals, and verification.
- [x] Structured engineering planner.
- [x] Lifecycle state model through release.
- [x] Schema-versioned database migrations and migration tests.
- [x] Repository-wide API contract/integration coverage for the current API surface.
- [x] Explicit factory-cycle, run, event, and artifact lineage semantics with cycle APIs.
- [x] Structured Fastify request logging, bounded failure handling, and machine-readable diagnostics baseline.
- [x] Reproducible `npm ci` CI, dependency auditing, and automated quality checks.
- [x] `.env.example`, operational setup, migration, and troubleshooting guidance aligned with runtime configuration.

### Phase 1 — Engineering knowledge and digital thread **[current]**
- [ ] Versioned requirements, decisions, assumptions, constraints, and acceptance criteria.
- [ ] First-class artifact/revision graph connecting prompts → plans → CAD → simulations → test results → releases.
- [ ] Engineering knowledge base with units, tolerances, materials, components, standards, and provenance.
- [ ] Retrieval and evidence layer with source attribution and freshness tracking.
- [ ] BOM and component lifecycle management.
- [ ] Supplier/component discovery with availability, cost, lead-time, and approved-source records.
- [ ] Change impact analysis and design review gates.

### Phase 2 — Autonomous CAD and mechanical design
- [ ] Parametric design representation independent of a single CAD vendor.
- [ ] CAD state snapshots, diffs, revisions, rollback, and deterministic replay.
- [ ] Multi-part assemblies, joints, fasteners, tolerances, materials, and manufacturability checks.
- [ ] Automated drawing/document generation.
- [ ] Design-space exploration and constrained optimization.
- [ ] Geometry/feature validation and regression tests against known designs.

### Phase 3 — Electronics and embedded systems
- [ ] Requirements-driven electronics architecture.
- [ ] Schematic and PCB design tool integration.
- [ ] Component selection and electrical rule checking.
- [ ] Power, thermal, signal-integrity, and interface analysis.
- [ ] Firmware generation, build, flashing, logging, and hardware-in-the-loop interfaces.
- [ ] Electronics BOM, substitutions, lifecycle and procurement integration.

### Phase 4 — Robotics software factory
- [ ] Generate robot software architecture from the same product specification.
- [ ] ROS 2 / middleware integration, drivers, perception, planning, control, telemetry, and safety layers.
- [ ] Repository/workspace generation, build, unit/integration testing, static analysis, and packaging.
- [ ] Hardware/software interface contracts generated from the engineering model.
- [ ] Software-in-the-loop and hardware-in-the-loop execution.

### Phase 5 — Simulation factory
- [ ] Standard simulation abstraction supporting physics, sensors, actuators, environments, and robot models.
- [ ] Automatic scenario generation from requirements and failure hypotheses.
- [ ] Batch simulation, parameter sweeps, Monte Carlo testing, and regression baselines.
- [ ] Automatic extraction of quantitative evidence.
- [ ] Sim-to-real gap tracking and calibration from real measurements.

### Phase 6 — Manufacturing factory
- [ ] CAM/toolpath planning and manufacturability analysis.
- [ ] Machine/tool/material capability registry.
- [ ] Work orders, scheduling, inventory, procurement, and traceability.
- [ ] Machine connectors behind a hardened authorization boundary.
- [ ] Automated fabrication for approved operations.
- [ ] In-process telemetry and machine-state monitoring.
- [ ] Metrology and automated inspection.

### Phase 7 — Physical test laboratory
- [ ] Test-plan generation directly from requirements and risk models.
- [ ] Instrumentation, fixtures, data acquisition, calibration, and test identity management.
- [ ] Vision-based inspection and dimensional measurement.
- [ ] Environmental, mechanical, electrical, endurance, and functional test infrastructure as appropriate to the product.
- [ ] Safe automated test execution with interlocks and emergency-stop integration.
- [ ] Reproducible test datasets and evidence packages.

### Phase 8 — Closed-loop autonomous innovation
- [ ] Failure diagnosis from simulation, manufacturing, telemetry, and physical-test evidence.
- [ ] Root-cause hypotheses with confidence and supporting evidence.
- [ ] Automatic design/software/test-plan revisions.
- [ ] Controlled experiment generation and A/B design comparison.
- [ ] Cost, performance, reliability, manufacturability, and schedule optimization.
- [ ] Bounded iterative loops with explicit stop conditions and rollback.
- [ ] Human review for high-impact decisions until the authorization system proves sufficient safety and reliability.

### Phase 9 — Full factory orchestration
- [ ] One persistent product graph spanning requirements, mechanical, electrical, firmware, software, simulation, manufacturing, and testing.
- [ ] Specialized local agents coordinated by a factory orchestrator.
- [ ] Capability discovery and dynamic task routing.
- [ ] Resource-aware scheduling across compute, machines, inventory, and test capacity.
- [ ] Long-running jobs with checkpointing, resumability, retries, and recovery.
- [ ] Provenance, audit trails, reproducibility, and release manifests.
- [ ] Operator dashboard for the complete factory state.

### Phase 10 — Production-grade autonomous R&D system
- [ ] Local deployment with no dependency on external inference for normal operation.
- [ ] Model evaluation, regression suites, versioning, rollback, and controlled model upgrades.
- [ ] Continuous improvement from accumulated engineering/test evidence.
- [ ] Multi-project resource scheduling and isolation.
- [ ] Production observability, security, backups, disaster recovery, and data retention.
- [ ] End-to-end acceptance test: a single sufficiently specified civilian robotics request produces a validated software/hardware design, simulation evidence, approved physical build, physical-test evidence, and an auditable release package.

## Development rule

`main` / `origin/main` is the sole development branch. Future `continue` iterations should read `GOAL.md` and this roadmap, identify the first incomplete item in the active phase, implement it fully, add or update tests, update migrations/docs/configuration/diagnostics as required, and verify the repository before moving to the next item. Do not mark roadmap work complete merely because code exists: it must be integrated, tested, documented, and operationally coherent.
