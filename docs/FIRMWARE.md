# Firmware generation

The firmware subsystem consumes the versioned electronics architecture rather than accepting an unrelated hand-written hardware description. Generated projects carry a SHA-256 hash of the exact architecture input for lineage and reproducibility.

## Current targets

- `portable-cpp` (toolchain `host-g++`) is the deterministic host-verification target. It generates a small C++17 program, builds it with `g++`, and emits a structured heartbeat telemetry event over stdout. It proves generated source and toolchain integration but is not board-specific.
- `avr-c` (toolchain `avr-gcc`, boards `atmega328p` / `atmega2560`) is a real board-specific cross-compilation target. It generates genuine embedded C that drives USART0 by direct register writes to emit the same `AI_FACTORY_HEARTBEAT N` telemetry protocol, cross-compiles it with `avr-gcc -mmcu=<board>`, and links a real Intel HEX firmware image with `avr-objcopy`. `avr-size` is run as an additional build step so the persisted build artifact carries real flash/RAM usage output for the target device. A successful build is genuine evidence the generated firmware is valid object code for that MCU — it is not a simulation of one.

Every generated project records `interfaces`, `buildCommand`, `postBuildSteps`, and (for board-specific targets) the expected output `image` path/format, so the exact toolchain invocation and produced artifact are reproducible from the persisted project alone.

## API

- `POST /api/projects/:id/firmware/generate` — generate and persist a firmware project artifact for either target.
- `GET /api/projects/:id/firmware/projects` — list generated firmware artifacts.
- `POST /api/projects/:id/firmware/hil` — build/execute the generated **host** target (`portable-cpp` only) and persist structured telemetry results.
- `POST /api/projects/:id/firmware/flash-plan` — construct (but never execute) a physical flashing command for `avrdude`, `dfu-util`, or `openocd`.

## Hardware boundary

Cross-compiling `avr-c` firmware verifies the build for a specific MCU; it does **not** flash physical hardware and it cannot be run through host HIL, because AVR machine code is not host machine code. `runFirmwareHil` explicitly rejects any non-`host-g++` target with an error naming this boundary rather than silently falling back to host simulation.

Physical flashing is intentionally not implied by generation, build, or HIL for either target. A device/programmer configuration, explicit authorization, safe device targeting, and post-flash verification must exist before a physical target can be programmed — `planFirmwareFlash` throws when asked to `execute` a flash for exactly this reason. Likewise, host HIL is not equivalent to physical HIL; hardware adapters and real on-device telemetry capture remain outstanding work.

## CI verification

The `verify` job builds and unit-tests both targets' project/command generation without requiring the AVR toolchain to be installed. A dedicated `avr-firmware-integration` job installs `gcc-avr`, `binutils-avr`, and `avr-libc`, then runs the real cross-compilation integration test (`AVR_GCC_INTEGRATION=1`) that asserts a genuine Intel HEX image is produced — mirroring how `kicad-integration` verifies the real KiCad CLI path.
