# AI Factory — End Goal

## Mission

Build a local-first autonomous research, engineering, manufacturing, and testing system that can turn a sufficiently specified natural-language product request into a real, validated civilian robot or drone with minimal human intervention.

The user should eventually provide one ordinary-language description of what they want built. The factory should translate that intent into a structured engineering specification, develop the required hardware and software, simulate it, manufacture an approved physical version, test it in the real world, learn from the evidence, iterate, and produce an auditable release package.

This is not a single model. It is an integrated **AI factory**: a persistent engineering graph, specialized agents, deterministic tools, simulation infrastructure, manufacturing equipment, test infrastructure, and an orchestration/runtime layer that keeps every decision and measurement connected.

## Target end-to-end loop

```text
Natural-language product request
        ↓
Intent + requirements extraction
        ↓
Engineering specification + acceptance criteria
        ↓
Architecture / trade studies
        ↓
Mechanical + electrical + embedded + software design
        ↓
Simulation + automated verification
        ↓
Manufacturing planning + BOM + procurement
        ↓
Approved physical construction
        ↓
Metrology + inspection
        ↓
Real-world test plan + safe execution
        ↓
Measured evidence
        ↓
Failure diagnosis / root-cause hypotheses
        ↓
Controlled design + software + test-plan iteration
        └──────────────────────────────────────────────↺

                         ↓
                 validated release
```

## Product definition

The target system should be capable of building civilian robotics such as inspection robots, environmental-monitoring platforms, educational robots, laboratory automation systems, and drones for benign research and industrial use.

The factory must maintain a machine-readable product definition containing at least:

- user intent and unresolved ambiguities;
- functional and non-functional requirements;
- constraints, assumptions, units, tolerances, and acceptance criteria;
- safety and risk constraints;
- mechanical architecture and parametric CAD;
- electronics architecture, schematics, PCB, power and interface definitions;
- embedded firmware and robotics software;
- BOM, approved components, suppliers, inventory, and substitutions;
- simulation models, scenarios, parameters, and results;
- manufacturing plans, work orders, machine capabilities, and process evidence;
- inspection and metrology results;
- physical test plans, instrumentation, raw measurements, and derived metrics;
- decisions, experiments, failures, hypotheses, revisions, and approvals;
- release manifests and complete provenance.

## Architecture principles

### 1. One persistent digital thread

Every important object must be addressable and versioned. Prompts, requirements, plans, CAD revisions, code commits/builds, simulation runs, BOM revisions, manufactured parts, inspections, tests, failures, and releases must be connected by explicit lineage.

A future engineer—or an AI agent—must be able to answer: **why does this artifact exist, which requirement caused it, which version produced it, what evidence validates it, and what changed afterward?**

### 2. Specialized agents, deterministic execution

Use models for reasoning, planning, synthesis, diagnosis, design exploration, and interpretation. Use deterministic software and physical systems for actions that require exactness: CAD operations, builds, simulation execution, measurements, manufacturing commands, data processing, and validation.

Agents should discover capabilities rather than relying on hard-coded assumptions about individual tools.

### 3. Local-first operation

Normal operation should require no external inference service. Models, vector/search infrastructure, engineering knowledge, databases, orchestration, and core telemetry should be runnable on local infrastructure.

Cloud providers may be optional acceleration paths, never an architectural requirement for the completed factory.

### 4. Evidence over confidence

An AI statement is not verification. Requirements are satisfied by measurable evidence from deterministic computation, simulation, inspection, or physical testing. Every verification result should identify its source, method, inputs, tolerances, timestamp, and relevant artifact/revision.

### 5. Bounded autonomy

Autonomy must have budgets and stop conditions: model calls, tool calls, compute, time, iterations, physical energy, machine operation, cost, and experiment count where relevant. Long-running work must checkpoint and resume safely.

### 6. Safe physical boundary

Physical operations require explicit authorization until the factory has demonstrated an appropriately engineered safety system. Machine connectors must support interlocks, preconditions, health checks, emergency-stop integration, monitoring, cancellation, and safe failure modes.

No agent should be able to bypass authorization through natural-language prompt injection, tool metadata, or an alternate connector.

### 7. Reproducibility

A release must be reproducible from recorded inputs, model/tool versions, source revisions, parameters, materials, machine settings, and evidence. Database migrations and artifact schemas must be versioned.

## Factory subsystems

### Intelligence layer

- Local foundation models for planning, coding, vision, multimodal engineering reasoning, and diagnosis.
- Model routing, evaluation, regression testing, versioning, and rollback.
- Retrieval over the factory's engineering knowledge and historical evidence.
- Specialist agents for requirements, mechanical engineering, electronics, software, simulation, manufacturing, inspection, testing, and diagnosis.
- A coordinator that decomposes work, assigns capabilities, tracks dependencies, and recovers failed jobs.

### Engineering layer

- Requirements and systems engineering.
- Architecture and trade-study engine.
- Parametric CAD and revision management.
- Electronics design and PCB workflows.
- Firmware and robotics software factory.
- BOM, supplier, component lifecycle, and procurement systems.
- Automated drawings and manufacturing documentation.

### Simulation layer

- Physics and robotics simulation abstraction.
- Sensor and actuator models.
- Environment/scenario generation.
- Software-in-the-loop and hardware-in-the-loop.
- Parameter sweeps and Monte Carlo evaluation.
- Regression baselines and sim-to-real calibration.

### Physical factory layer

- Material/component inventory.
- Machine and tool capability registry.
- CAM and manufacturing planning.
- Fabrication equipment and safe machine connectors.
- Assembly workflows.
- Metrology and automated visual inspection.
- Instrumentation and test fixtures.
- Controlled test environments.

### Control-plane layer

- Persistent project/product graph.
- Event log and provenance.
- Lifecycle state machine.
- Approval and authorization service.
- Job queue and scheduler.
- Resource management.
- Checkpointing, retry, rollback, and recovery.
- Operator console and factory observability.

## Autonomous innovation loop

The defining capability is not simply autonomous construction. It is **autonomous improvement**.

When a design fails a requirement, simulation, inspection, or physical test, the factory should:

1. collect the complete evidence;
2. identify the failing requirement and affected artifacts;
3. generate competing root-cause hypotheses;
4. rank hypotheses using evidence and engineering constraints;
5. propose controlled design/software/process changes;
6. predict their effect through simulation or analysis;
7. run the safest useful experiment;
8. compare results against the baseline;
9. retain successful changes and their evidence;
10. repeat until acceptance criteria are met or a bounded stop condition is reached.

The system should preserve unsuccessful experiments rather than hiding them. Failed experiments are part of the factory's institutional engineering memory.

## Definition of full success

The end goal is reached only when the repository and connected factory infrastructure can demonstrate an end-to-end acceptance test in which a sufficiently specified benign robotics request is submitted once and the system autonomously:

1. resolves or explicitly escalates ambiguities;
2. creates a traceable engineering specification;
3. produces mechanical, electrical, embedded, and software designs;
4. generates and validates simulation models and test scenarios;
5. produces a manufacturing-ready BOM and process;
6. obtains required components/materials through approved procurement paths;
7. constructs the physical product through authorized equipment;
8. inspects the result and rejects nonconforming parts;
9. executes an approved physical test plan safely;
10. records quantitative evidence;
11. diagnoses failures and performs bounded iterations;
12. repeats simulation and physical testing as necessary;
13. demonstrates all mandatory acceptance criteria;
14. creates a complete, reproducible, auditable release package.

Human oversight remains available throughout the system and is mandatory at safety-critical or otherwise consequential boundaries until those boundaries have been separately validated and authorized.

## Development doctrine

This file is the long-term source of truth for the destination. `README.md` contains the executable roadmap toward it.

Development is exclusively on **`main` / `origin/main`**.

For every `continue` request:

1. Read this file and the current README roadmap.
2. Inspect the actual repository state; never assume previous work is still present.
3. Select the first incomplete item in the active roadmap phase.
4. Implement the complete vertical slice, not merely a type or placeholder.
5. Update database migrations/schema, API contracts, tests, diagnostics, configuration, and documentation wherever the change affects them.
6. Run typechecking, tests, build, and appropriate runtime/doctor checks.
7. Fix regressions before proceeding.
8. Mark the roadmap item complete only when it is genuinely integrated and operational.
9. Commit the completed work directly to `main`.
10. Move to the next roadmap item only after the current item is complete.

The standard is not "the code exists". The standard is **the capability works, is evidenced by tests, is observable, is documented, and remains compatible with the full factory architecture**.
