# AGENTS.md

## Project

DragonFly 65 is a hypothetical W65C832-inspired computer, operating system, and
SSH-accessible environment written in TypeScript for Bun.

Treat the project as a real computer first. The immediate priority is a
bootable monitor-based development loop, not higher-level language polish.

Current project status and longer milestone history live in
`docs/milestones.md`.

## Commands

- Install dependencies: `bun install`
- Run local app entrypoint: `bun run dev`
- Boot DragonFly computer: `bun run computer`
- Run monitor: `bun run monitor`
- Run assembler: `bun run asm`
- Run Lovelace compiler: `bun run lace`
- Run tests: `bun test`
- Typecheck: `bun run typecheck`

## Current Priority

Build the first real DragonFly 65 computer workflow. The next milestone is
documented in `docs/milestones.md`:

```text
Bootable Monitor Computer
```

Work through this checklist in order unless the user explicitly redirects:

- [x] CPU emulator exists and can execute monitor-supporting code.
- [x] W65C832 assembler exists and can build monitor/program assembly.
- [x] ROM monitor source exists at `monitor/monitor.asm`.
- [x] Monitor can run in the emulator via `bun run monitor`.
- [x] Monitor documentation started in `docs/monitor.md`.
- [x] Finish monitor documentation.
  Cover command syntax, memory map, boot behavior, CPU conventions, program ABI,
  and current limitations.
- [x] Add a real computer entrypoint.
  Introduce `bun run computer` as the canonical way to boot DragonFly 65 into
  monitor ROM.
- [x] Treat monitor as ROM in the machine workflow.
  Load monitor at the documented ROM address, use the reset vector emitted by
  the ROM, and keep user RAM separate from monitor workspace.
- [x] Add monitor assembly mode.
  Add a monitor command that accepts assembly source through the monitor prompt.
  This must be implemented as a monitor-resident mini assembler in W65C832
  assembly, not by calling the TypeScript host assembler or side-loading bytes.
  Start with the smallest subset needed for Hello World, write bytes into RAM,
  and then run the program with `G`.
- [x] Add monitor disassembly mode.
  Add a `D` command that disassembles the same opcode subset supported by the
  monitor assembler.
- [ ] Grow the native assembler and disassembler together.
  After monitor assembly/disassembly mode works, expand both W65C832 assembly
  implementations toward the TypeScript assembler's instruction/directive
  coverage in small, tested chunks. Do not add assembler support for an opcode
  without adding matching disassembler support in the same change.
- [ ] Add optional run-on-boot support.
  Support a development shortcut such as `--go <addr>` while keeping normal boot
  behavior monitor-first.
- [ ] Add assembly examples.
  Include small programs that can be entered through monitor assembly mode,
  starting with Hello World output through `$F000`.
- [ ] Add smoke tests for the real workflow.
  Boot the computer, enter assembly through the monitor, run it with `G`, and
  verify output or register state.
- [ ] Update docs and milestones after each completed chunk.
  Keep `AGENTS.md` short; put longer status/history in `docs/milestones.md`.
- [ ] Only then adapt Lovelace to the monitor ABI.
  Add a monitor-target output mode, make `print()` real for this target, and
  ensure monitor-launched programs return with `RTS` instead of stopping the
  machine.

Do not treat Lovelace, NeedleOS, SSH, or Fly.io work as the next priority unless
the user explicitly asks for it. Lovelace currently has substantial compiler
work, but it is not yet the primary real-machine development path.

## Authoritative References

- Monitor documentation and ABI: `docs/monitor.md`
- Project milestones and status: `docs/milestones.md`
- Emulator roadmap: `docs/emulator-roadmap.md`
- Processor design: `docs/processor-design.md`
- Lovelace language design: `docs/lovelace-language-design.md`
- Lovelace unsupported/runtime gaps: `docs/lovelace-unsupported.md`
- Lovelace runtime notes: `docs/lovelace-runtime.md`
- Compliance notes: `docs/compliance.md`
- Third-party notices: `THIRD_PARTY_NOTICES.md`

## Current Monitor Model

The monitor is written in W65C832 assembly at `monitor/monitor.asm`.

Current monitor commands:

- `H`: help
- `M`: dump memory
- `S`: set memory bytes
- `G`: run code at an address using `JSR`
- `R`: show registers saved after the last returned `G`
- `A`: assemble source into RAM
- `D`: disassemble RAM

The monitor ABI is documented in `docs/monitor.md`. Programs launched with `G`
should currently return with `RTS`. Terminal output is produced by writing bytes
to `$F000`.

## Engineering Guidelines

- Prefer small, focused changes that match the existing project structure.
- Keep the W65C832 emulator reusable as an independent TypeScript library.
- Do not couple `src/emulator/` to DragonFly 65 OS, SSH, Fly.io, or server
  concerns.
- Keep DragonFly-specific machine behavior in `src/machine/` or higher layers.
- Keep CPU clock behavior externally configurable.
- Keep TypeScript strict and explicit around CPU, memory, operating system, and
  network state.
- Add tests for emulator, monitor, machine, in-monitor assembly, operating
  system, SSH, and protocol behavior as those areas are introduced.
- Document invented architecture decisions in `docs/`.
- Do not treat real W65C832 behavior as guessed fact. Verify it, cite it in
  docs, or clearly mark it as DragonFly 65-specific design.
- Keep runtime assumptions compatible with Bun and container deployment.

## Upstream And Licensing

- The project is licensed under GPL-3.0-only.
- Keep public-facing files clear and welcoming.
- Use issues or design documents for large architecture decisions before
  implementation.
- The W65C832 behavior is informed by WDC documentation and Michael Kohn's
  open-source work.
- Michael Kohn's MIT `w65c832` core may be treated as portable with attribution.
- GPL-3.0 `naken_asm` code may be ported into DragonFly 65 with attribution,
  since DragonFly 65 is GPL-3.0-only.
- Keep `THIRD_PARTY_NOTICES.md` and `docs/compliance.md` accurate when using
  upstream code or behavior.
