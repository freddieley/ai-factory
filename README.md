# AI Factory

A local-first AI engineering control plane for civilian robotics: **plain-language request → requirements → engineering plan → CAD → simulation → verification → manufacturing → physical testing → autonomous iteration → release**.

The repository is deliberately being built as a staged autonomy stack. The current system can plan and execute bounded CAD workflows, persist engineering state, and keep consequential physical operations behind explicit approval. The long-term target is a locally operated research-and-development factory capable of taking a sufficiently specified product request and coordinating the software, hardware, simulation, manufacturing, testing, and iteration required to produce a real-world robot or drone.

See **[GOAL.md](./GOAL.md)** for the complete end-state specification and design principles. Treat the roadmap below as the canonical development queue: when continuing development, finish the current phase completely—including implementation, tests, documentation, migrations, diagnostics, and CI—before moving forward.

### Phase 2 — Autonomous CAD and mechanical design **[current]**
- [x] Parametric design representation independent of a single CAD vendor — canonical metric model, named dimensional parameters, vendor-neutral mechanical features, validation, and deterministic serialization.
- [x] CAD state snapshots, deterministic diffs, immutable revisions, hash-verified replay, revision-targeted rollback, and auditable rollback-as-new-revision semantics.
- [x] Multi-part assembly foundation — stable parts, joints, fasteners, tolerances, materials, deterministic serialization, and baseline manufacturability findings.
- [x] Assembly engineering constraints — coordinate frames, joint limits, material/process compatibility, mass estimation where geometry permits, and machine/process capability checks.
- [x] Robust geometric transforms, datum schemes, fit/clearance analysis, richer material/process data, and machine-specific capability evidence.
- [x] Automated drawing/document generation.
- [x] Design-space exploration and constrained optimization — bounded deterministic candidate enumeration, constraint filtering, objective ranking, factory capability discovery, API execution, and persisted hash-verified exploration artifacts.
- [x] Geometry/feature validation and regression tests against known designs.

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
- [ ] Deterministic simulation runs, metrics, traces, evidence, and regression baselines.
- [ ] Parameter sweeps, uncertainty analysis, and simulation-based design optimization.
- [ ] Sim-to-real validation gates and calibration workflows.

### Phase 6 — Manufacturing and factory automation
- [ ] Process planning from BOM and geometry.
- [ ] Machine/tool capability registry and scheduling.
- [ ] CAM/CNC/3D-print/laser-cut/assembly integrations.
- [ ] Work instructions, machine-readable jobs, material traceability, and inspection plans.
- [ ] Automated metrology and quality-control evidence.
- [ ] Physical cell orchestration with explicit safety interlocks and human approval gates.

### Phase 7 — Autonomous physical testing
- [ ] Test-plan synthesis from requirements, hazards, and design assumptions.
- [ ] Instrumentation, telemetry, cameras, environmental sensing, and synchronized evidence capture.
- [ ] Automated bench tests and controlled functional tests.
- [ ] Fault injection, boundary testing, endurance testing, and regression campaigns.
- [ ] Automatic failure triage, root-cause hypotheses, experiment selection, and evidence-backed design changes.

### Phase 8 — Closed-loop autonomous R&D
- [ ] Unified experiment/evidence graph across requirements, design, software, simulation, manufacturing, and physical tests.
- [ ] Autonomous hypothesis generation and ranking.
- [ ] Constrained design-space search with budget, safety, manufacturability, and performance objectives.
- [ ] Parallel candidate generation, verification, fabrication, and testing.
- [ ] Learning from every simulation and physical experiment without corrupting provenance.
- [ ] Release gates requiring reproducibility, traceability, verification evidence, and explicit policy compliance.

### Phase 9 — Full product factory
- [ ] Single-prompt product intake for sufficiently specified benign civilian robotics projects.
- [ ] Automatic decomposition into mechanical, electrical, firmware, software, simulation, manufacturing, and test workstreams.
- [ ] Cross-domain dependency management and synchronized revisions.
- [ ] Autonomous build-to-test loops with escalation when confidence or evidence is insufficient.
- [ ] Production-ready artifact packages, assembly instructions, test reports, and complete provenance.

### Development rule

`main` / `origin/main` is the sole development branch. On `continue`, start at the first incomplete item in the active phase. Finish the item end-to-end—including implementation, tests, documentation, migrations, diagnostics, and CI—before marking it complete or advancing. Never treat a stub, mock-only path, or unverified integration as completion.
