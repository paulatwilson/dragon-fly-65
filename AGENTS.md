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
- Run monitor: `bun run monitor`
- Run assembler: `bun run asm`
- Run Lovelace compiler: `bun run lace`
- Run tests: `bun test`
- Typecheck: `bun run typecheck`

## Current Priority

Build the first real DragonFly 65 computer workflow:

```text
CPU emulator
  -> assembler
  -> ROM monitor
  -> bootable computer
  -> documented monitor
  -> program loader
  -> assembly examples
  -> higher-level languages
```

The next milestone is documented in `docs/milestones.md`:

```text
Bootable Monitor Computer
```

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
- Add tests for emulator, monitor, machine, loader, operating system, SSH, and
  protocol behavior as those areas are introduced.
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
