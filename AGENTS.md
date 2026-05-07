# AGENTS.md

## Project

DragonFly 65 is a hypothetical W65C832-inspired computer, operating system, and SSH-accessible environment written in TypeScript for Bun.

The project is intended to become an open-source system that can run on Fly.io.

## Commands

- Install dependencies: `bun install`
- Run locally: `bun run dev`
- Run tests: `bun test`
- Typecheck: `bun run typecheck`

## Active Plans

- Processor emulator chunks are tracked in `docs/emulator-roadmap.md`.

## Roadmap

### Create the W65C832 emulator

Emulator details live in `docs/emulator-roadmap.md`. Glance progress:

- [x] [Chunk 0: Foundation](docs/emulator-roadmap.md#chunk-0-foundation).
- [x] [Chunk 1: Execution core shape](docs/emulator-roadmap.md#chunk-1-execution-core-shape).
- [x] [Chunk 2: Fetch helpers and immediate addressing](docs/emulator-roadmap.md#chunk-2-fetch-helpers-and-immediate-addressing).
- [x] [Chunk 3: Load instructions](docs/emulator-roadmap.md#chunk-3-load-instructions).
- [x] [Chunk 4: Store instructions](docs/emulator-roadmap.md#chunk-4-store-instructions).
- [x] [Chunk 5: Transfers and register operations](docs/emulator-roadmap.md#chunk-5-transfers-and-register-operations).
- [x] [Chunk 6: Stack basics](docs/emulator-roadmap.md#chunk-6-stack-basics).
- [x] [Chunk 7: Branches and jumps](docs/emulator-roadmap.md#chunk-7-branches-and-jumps).
- [x] [Chunk 8: Subroutines](docs/emulator-roadmap.md#chunk-8-subroutines).
- [x] [Chunk 9: ALU and comparisons](docs/emulator-roadmap.md#chunk-9-alu-and-comparisons).
- [x] [Chunk 10: Addressing modes](docs/emulator-roadmap.md#chunk-10-addressing-modes).
- [x] [Chunk 11: Mode switching](docs/emulator-roadmap.md#chunk-11-mode-switching).
- [x] [Chunk 12: Interrupts and vectors](docs/emulator-roadmap.md#chunk-12-interrupts-and-vectors).
- [x] [Chunk 13: Opcode family coverage pass](docs/emulator-roadmap.md#chunk-13-coverage-pass-for-opcode-families).
- [x] [Chunk 14: Timing metadata](docs/emulator-roadmap.md#chunk-14-timing-metadata).
- [x] [Chunk 15: Compatibility and validation](docs/emulator-roadmap.md#chunk-15-compatibility-and-validation).
- [x] [Chunk 16: Public API hardening](docs/emulator-roadmap.md#chunk-16-public-api-hardening).

### Create an original W65C832 assembler

- [x] Core assembler (`src/assembler/`) — two-pass cross-assembler, 138 tests
  - Full W65C816 + W65C832 instruction set (all 256 opcodes)
  - Directives: `.org`, `.db`, `.dw`, `.dl`, `.ascii`, `.asciiz`, `.resb`, `.equ`, `.65816`, `.65832`, `.a8`, `.a16`, `.a32`, `.i8`, `.i16`, `.i32`
  - Address auto-selection (dp/abs/long) with `<`, `!`, `>` force modifiers
  - Two-pass label resolution with forward reference support
  - REP/SEP auto-track accumulator/index width for correct immediate encoding
  - Opcode table derived from Michael Kohn's `naken_asm` (GPL-3.0, with attribution)
- [ ] Assembler CLI / REPL interface
- [ ] Disassembler

- informed by Michael Kohn's open-source `naken_asm`: <https://github.com/mikeakohn/naken_asm>. Give full credit to Michael Kohn and the `naken_asm` project wherever this work is documented
- When porting from `naken_asm`, preserve Michael Kohn's copyright notice and document which parts are derived in `THIRD_PARTY_NOTICES.md`

### Build a test rig to test the assembler

### Build a basic monitor in W65C832 assembler

### Build the SSH server for DragonFly 65

### Deploy to Fly.io

### Define DragonFly 65 (DF65)

### Create a custom language for DF65

### Build NeedleOS in W65C832 using the custom language

## Guidelines

- Prefer small, focused changes that match the existing project structure.
- Follow `docs/emulator-roadmap.md` when working on the W65C832 emulator. Complete one chunk at a time and keep tests close to the behavior being added.
- Keep the W65C832 emulator reusable as an independent TypeScript library. Do not couple `src/emulator/` to DragonFly 65 OS, SSH, Fly.io, or server concerns.
- Keep CPU clock behavior externally configurable. DragonFly 65's fictional 40 MHz variant belongs in app/machine config, while the reusable emulator only validates and reports supplied clock metadata.
- Keep TypeScript strict and explicit around CPU, memory, operating system, and network state.
- Add tests for emulator, operating system, SSH, and protocol behavior as those areas are introduced.
- Document invented architecture decisions in `docs/`.
- Do not treat real W65C832 behavior as guessed fact. Verify it, cite it in docs, or clearly mark the behavior as DragonFly 65-specific design.
- Keep runtime assumptions compatible with Bun and container deployment.
- Keep `THIRD_PARTY_NOTICES.md` and `docs/compliance.md` accurate when using upstream code or behavior.

## Open Source

- Keep public-facing files clear and welcoming.
- The project is licensed under GPL-3.0-only.
- Use issues or design documents for large architecture decisions before implementation.
- Treat Michael Kohn's MIT `w65c832` core as portable with attribution. GPL-3.0 `naken_asm` code may be ported into DragonFly 65 with attribution, since both projects are now GPL-3.0.
