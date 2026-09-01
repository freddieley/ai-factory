                         ┌─────────────────────┐
                         │       USER          │
                         │ "Build me a drone   │
                         │  that can do X..."  │
                         └──────────┬──────────┘
                                    │
                                    ▼
                    ┌──────────────────────────┐
                    │ REQUIREMENTS ENGINE      │
                    │                          │
                    │ Intent                   │
                    │ Constraints              │
                    │ Performance targets      │
                    │ Environment              │
                    │ Cost / mass / size       │
                    └─────────────┬────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ ENGINEERING PLANNER      │
                    │                          │
                    │ Architecture             │
                    │ Components               │
                    │ Interfaces               │
                    │ Dependencies             │
                    │ Experiments              │
                    └─────────────┬────────────┘
                                  │
             ┌────────────────────┼─────────────────────┐
             ▼                    ▼                     ▼
      ┌─────────────┐      ┌─────────────┐      ┌──────────────┐
      │ HARDWARE    │      │ SOFTWARE    │      │ SIMULATION   │
      │ FACTORY     │      │ FACTORY     │      │ ENGINE       │
      │             │      │             │      │              │
      │ CAD         │      │ firmware    │      │ physics      │
      │ electronics │      │ autonomy    │      │ aerodynamics │
      │ mechanisms  │      │ perception  │      │ controls     │
      │ assemblies  │      │ planning    │      │ stress       │
      └──────┬──────┘      └──────┬──────┘      └──────┬───────┘
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  ▼
                    ┌──────────────────────────┐
                    │ INTEGRATION ENGINE       │
                    │                          │
                    │ HW + SW + configuration  │
                    └─────────────┬────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ TEST & EXPERIMENT ENGINE │
                    │                          │
                    │ simulate                 │
                    │ manufacture              │
                    │ measure                  │
                    │ compare                  │
                    └─────────────┬────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ EVALUATION ENGINE        │
                    │                          │
                    │ Requirements satisfied?  │
                    │ Failure analysis         │
                    │ Performance delta        │
                    └─────────────┬────────────┘
                                  │
                             NO ──┴── YES
                              │         │
                              ▼         ▼
                         ITERATE      RELEASE