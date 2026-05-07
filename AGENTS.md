# AGENTS.md

## Project

Dragon Fly 65 is a hypothetical W65C832-inspired computer, operating system, and SSH-accessible environment written in TypeScript for Bun.

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

- [x] Chunk 0: Foundation.
- [ ] Chunk 1: Execution core shape.
- [ ] Chunk 2: Fetch helpers and immediate addressing.
- [ ] Chunk 3: Load instructions.
- [ ] Chunk 4: Store instructions.
- [ ] Chunk 5: Transfers and register operations.
- [ ] Chunk 6: Stack basics.
- [ ] Chunk 7: Branches and jumps.
- [ ] Chunk 8: Subroutines.
- [ ] Chunk 9: ALU and comparisons.
- [ ] Chunk 10: Addressing modes.
- [ ] Chunk 11: Mode switching.
- [ ] Chunk 12: Interrupts and vectors.
- [ ] Chunk 13: Opcode family coverage pass.
- [ ] Chunk 14: Timing metadata.
- [ ] Chunk 15: Compatibility and validation.
- [ ] Chunk 16: Public API hardening.

### Create an original W65C832 assembler

- informed by Michael Kohn's open-source `naken_asm`: <https://github.com/mikeakohn/naken_asm>. Give full credit to Michael Kohn and the `naken_asm` project wherever this work is documented
- Do not copy GPL-3.0 `naken_asm` source into MIT-licensed Dragon Fly 65 modules without an explicit licensing decision

### Build a test rig to test the assembler

### Build a basic monitor in W65C832 assembler

### Build the SSH server for Dragon Fly 65

### Deploy to Fly.io

### Define Dragon Fly 65 (DF65)

### Create a custom language for DF65

### Build DF65/OS in W65C832 using the custom language.

## Guidelines

- Prefer small, focused changes that match the existing project structure.
- Follow `docs/emulator-roadmap.md` when working on the W65C832 emulator. Complete one chunk at a time and keep tests close to the behavior being added.
- Keep the W65C832 emulator reusable as an independent TypeScript library. Do not couple `src/emulator/` to Dragon Fly 65 OS, SSH, Fly.io, or server concerns.
- Keep CPU clock behavior externally configurable. Dragon Fly 65's fictional 40 MHz variant belongs in app/machine config, while the reusable emulator only validates and reports supplied clock metadata.
- Keep TypeScript strict and explicit around CPU, memory, operating system, and network state.
- Add tests for emulator, operating system, SSH, and protocol behavior as those areas are introduced.
- Document invented architecture decisions in `docs/`.
- Do not treat real W65C832 behavior as guessed fact. Verify it, cite it in docs, or clearly mark the behavior as Dragon Fly 65-specific design.
- Keep runtime assumptions compatible with Bun and container deployment.
- Keep `THIRD_PARTY_NOTICES.md` and `docs/compliance.md` accurate when using upstream code or behavior.

## Open Source

- Keep public-facing files clear and welcoming.
- Preserve the MIT license unless the project maintainer explicitly changes it.
- Use issues or design documents for large architecture decisions before implementation.
- Treat Michael Kohn's MIT `w65c832` core as portable with attribution, and GPL-3.0 `naken_asm` as reference-only unless the maintainer explicitly approves GPL-derived code.
