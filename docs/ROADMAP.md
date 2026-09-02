# Roadmap

This is the execution queue for the factory. Work is complete only when implementation, tests, migrations, diagnostics, documentation, and operational behavior agree.

## Phase 1 — Engineering knowledge and digital thread **[complete]**
- [x] Versioned requirements, decisions, assumptions, constraints, and acceptance criteria.
- [x] First-class artifact/revision graph connecting engineering artifacts through explicit lineage and revision history.
- [x] Engineering knowledge base with units, tolerances, materials, components, standards, manufacturing constraints, and provenance fields.
- [x] Evidence source registry with attribution, confidence, timestamps, expiry, and content hashes.
- [x] Evidence claim registry with project isolation and freshness-aware retrieval.
- [x] BOM and component lifecycle management — versioned project BOMs, component references, single approved revision, lifecycle history and evidence linkage.
- [x] Supplier/component discovery — project-scoped suppliers, observed offers, availability/cost/lead-time data, provenance, freshness, procurement ranking, and explicit approved-source records.
- [x] Change impact analysis and design review gates — downstream artifact traversal, requirement/artifact traceability, persistent impact analyses, blocking findings, and deterministic approval decisions.

## Phase 2 — Autonomous CAD and mechanical design **[complete]**
- [x] Parametric design representation independent of a single CAD vendor — canonical metric model, named dimensional parameters, vendor-neutral mechanical features, validation, and deterministic serialization.
- [x] CAD state snapshots, deterministic diffs, immutable revisions, hash-verified replay, revision-targeted rollback, and auditable rollback-as-new-revision semantics.
- [x] Multi-part assembly foundation — stable parts, joints, fasteners, tolerances, materials, deterministic serialization, and baseline manufacturability findings.
- [x] Assembly engineering constraints — coordinate frames, joint limits, material/process compatibility, mass estimation where geometry permits, and machine/process capability checks.
- [x] Robust geometric transforms, datum schemes, fit/clearance analysis, richer material/process data, and machine-specific capability evidence.
- [x] Automated drawing/document generation.
- [x] Design-space exploration and constrained optimization — bounded deterministic candidate enumeration, constraint filtering, objective ranking, factory capability discovery, API execution, and persisted hash-verified exploration artifacts.
- [x] Geometry/feature validation and regression tests against known designs.

## Phase 3 — Electronics and embedded systems **[current]**
- [x] Requirements-driven electronics architecture — deterministic architecture synthesis from project electrical requirements, requirement traceability, power-domain extraction, functional blocks, interface identification, explicit open questions, capability discovery, API execution, hash-identified artifact persistence, and unit/API regression coverage.
- [x] Schematic and PCB design tool integration — real KiCad CLI integration for project-scoped schematic ERC, PCB DRC, optional netlist export, structured validation reports, path isolation, persisted validation artifacts, and KiCad 9 CI integration tests.
- [x] Component selection and electrical rule checking — deterministic component ranking and selection against the requirements-driven architecture, lifecycle enforcement, voltage/current compatibility, functional and interface coverage, uniqueness checks, explicit ERC pass/fail findings, persisted hash-verified selection artifacts, capability discovery, API execution, and unit/API regression coverage.
- [ ] Power, thermal, signal-integrity, and interface analysis.
- [ ] Firmware generation, build, flashing, logging, and hardware-in-the-loop interfaces.
- [ ] Electronics BOM, substitutions, lifecycle and procurement integration.

## Phase 4 — Robotics software factory
- [ ] Generate robot software architecture from the same product specification.
- [ ] ROS 2 / middleware integration, drivers, perception, planning, control, telemetry, and safety layers.
- [ ] Repository/workspace generation, build, unit/integration testing, static analysis, and packaging.
- [ ] Hardware/software interface contracts generated from the engineering model.
- [ ] Software-in-the-loop and hardware-in-the-loop execution.

## Phase 5 — Simulation factory
- [ ] Standard simulation abstraction supporting physics, sensors, actuators, environments, and robot models.
- [ ] Automatic scenario generation from requirements and failure hypotheses.
- [ ] Batch simulation, parameter sweeps, Monte Carlo testing, and regression baselines.
- [ ] Automatic extraction of quantitative evidence.
- [ ] Sim-to-real gap tracking and calibration from real measurements.

## Phase 6 — Manufacturing factory
- [ ] CAM/toolpath planning and manufacturability analysis.
- [ ] Machine/tool/material capability registry.
- [ ] Work orders, scheduling, inventory, procurement, and traceability.
- [ ] Machine connectors behind a hardened authorization boundary.
- [ ] Automated fabrication for approved operations.
- [ ] In-process telemetry and machine-state monitoring.
- [ ] Metrology and automated inspection.

## Phase 7 — Physical test laboratory
- [ ] Test-plan generation directly from requirements and risk models.
- [ ] Instrumentation, fixtures, data acquisition, calibration, and test identity management.
- [ ] Vision-based inspection and dimensional measurement.
- [ ] Environmental, mechanical, electrical, endurance, and functional test infrastructure as appropriate to the product.
- [ ] Safe automated test execution with interlocks and emergency-stop integration.
- [ ] Reproducible test datasets and evidence packages.

## Phase 8 — Closed-loop autonomous innovation
- [ ] Failure diagnosis from simulation, manufacturing, telemetry, and physical-test evidence.
- [ ] Root-cause hypotheses with confidence and supporting evidence.
- [ ] Automatic design/software/test-plan revisions.
- [ ] Controlled experiment generation and A/B design comparison.
- [ ] Cost, performance, reliability, manufacturability, and schedule optimization.
- [ ] Bounded iterative loops with explicit stop conditions and rollback.
- [ ] Human review for high-impact decisions until authorization controls are proven sufficient.

## Phase 9 — Full factory orchestration
- [ ] One persistent product graph spanning requirements, mechanical, electrical, firmware, software, simulation, manufacturing, and testing.
- [ ] Specialized local agents coordinated by a factory orchestrator.
- [ ] Capability discovery and dynamic task routing.
- [ ] Resource-aware scheduling across compute, machines, inventory, and test capacity.
- [ ] Long-running jobs with checkpointing, resumability, retries, and recovery.
- [ ] Provenance, audit trails, reproducibility, and release manifests.
- [ ] Operator dashboard for complete factory state.

## Phase 10 — Production-grade autonomous R&D
- [ ] Local deployment with no external inference dependency for normal operation.
- [ ] Model evaluation, regression suites, versioning, rollback, and controlled upgrades.
- [ ] Continuous improvement from accumulated engineering/test evidence.
- [ ] Multi-project resource scheduling and isolation.
- [ ] Production observability, security, backups, disaster recovery, and retention.
- [ ] End-to-end acceptance: a sufficiently specified benign civilian robotics request produces a validated software/hardware design, simulation evidence, approved physical build, physical-test evidence, and an auditable release package.

## Development rule

`main` / `origin/main` is the sole development branch. On `continue`, start at the first incomplete item in the active phase; finish the item end-to-end—including code, tests, migrations, diagnostics, documentation, and CI—before marking it complete or advancing. Never treat a stub, mock-only path, or unverified integration as completion.
