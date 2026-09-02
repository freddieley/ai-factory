# Firmware generation

The firmware subsystem consumes the versioned electronics architecture rather than accepting an unrelated hand-written hardware description. Generated projects carry a SHA-256 hash of the exact architecture input for lineage and reproducibility.

## Current target

`portable-cpp` is the deterministic verification target. It generates a small C++17 firmware program, builds it with `g++`, and emits a structured heartbeat telemetry event. The host build verifies generated source and toolchain integration without pretending to validate a physical board.

## API

- `POST /api/projects/:id/firmware/generate` — generate and persist a firmware project artifact.
- `GET /api/projects/:id/firmware/projects` — list generated firmware artifacts.
- `POST /api/projects/:id/firmware/hil` — build/execute the generated host target and persist structured telemetry results.

## Hardware boundary

Physical flashing is intentionally not implied by host generation or HIL. A board-specific HAL, cross-toolchain, device identity, flashing adapter, and explicit authorization boundary must exist before a physical target can be programmed. Likewise, host HIL is not equivalent to physical HIL; hardware adapters and real telemetry capture remain outstanding work.
