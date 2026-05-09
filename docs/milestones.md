# DragonFly 65 Milestones

This document tracks project status and historical completion detail. Keep
`AGENTS.md` focused on current operating instructions; keep longer status here.

## Current Direction

DragonFly 65 should be developed as a real computer first.

The foundation is:

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

Lovelace remains important, but it should target a working machine and monitor
ABI instead of driving the project order.

## Status Summary

```text
W65C832 emulator                  done
W65C832 assembler                 done
Assembler CLI / REPL              done
Monitor assembly source           done
Monitor can run in emulator       done, but not yet a complete computer workflow
Bootable DragonFly computer       started: `bun run computer` boots monitor
Host bootstrapper / loader        not done
Documented monitor                done for current monitor ABI
Assembly examples                 not done
Lovelace compiler v1              partial / experimental target
NeedleOS                          not started
Self-hosting Lovelace compiler    not started
Fly.io deployment                 not started
```

## Near-Term Milestone: Bootable Monitor Computer

Definition of done:

- `bun run computer` boots DragonFly 65 into the monitor.
- Monitor ROM is loaded at its documented ROM address.
- Reset vector points at the monitor entry.
- User RAM is separate from monitor workspace and ROM.
- `docs/monitor.md` documents commands, memory map, and ABI.
- A host-side loader can load a binary at an address before boot or while
  starting the machine.
- At least one assembly "Hello World" can be assembled, loaded at `$0300`, run
  with `G0300`, and observed through monitor output.
- Smoke tests cover booting the monitor, loading a binary, running it, and
  verifying output or register state.

Suggested chunks:

```text
Chunk 1: Add computer entrypoint [done]
  bun run computer
  Boots the machine into monitor ROM.

Chunk 2: Finish monitor documentation
  docs/monitor.md
  commands, memory map, boot behavior, ABI.

Chunk 3: Add host loader
  --load <bin>
  --at <addr>
  optional --go <addr>

Chunk 4: Add assembly examples
  examples/asm/hello.asm
  examples/asm/registers.asm
  examples/asm/memory.asm

Chunk 5: Add smoke tests
  boot monitor
  load asm binary
  run with G
  verify terminal output
```

## Completed: W65C832 Emulator

Details are tracked in `docs/emulator-roadmap.md`.

Completed capabilities include:

- Reusable emulator module boundary in `src/emulator/`.
- CPU state, status flags, clock metadata, and memory interfaces.
- Reset vector behavior.
- Register width and emulation mode behavior.
- Instruction execution table.
- Addressing helpers.
- Core loads, stores, transfers, stack operations, branches, jumps, subroutines,
  ALU operations, comparisons, mode switching, interrupts, and monitor-supporting
  opcodes.

Keep `src/emulator/` reusable. It must not depend on DragonFly machine,
NeedleOS, SSH, Fly.io, or server concerns.

## Completed: W65C832 Assembler

The assembler lives in `src/assembler/`.

Completed capabilities include:

- Two-pass cross-assembler.
- Full W65C816 + W65C832 opcode table.
- Directives: `.org`, `.db`, `.dw`, `.dl`, `.ascii`, `.asciiz`, `.resb`,
  `.equ`, `.65816`, `.65832`, `.a8`, `.a16`, `.a32`, `.i8`, `.i16`, `.i32`.
- Address auto-selection with `<`, `!`, and `>` force modifiers.
- Forward label resolution.
- REP/SEP width tracking for immediate operand encoding.
- CLI and REPL via `bun run asm`.

Attribution:

- The opcode table is informed by Michael Kohn's `naken_asm`.
- Keep `THIRD_PARTY_NOTICES.md` and `docs/compliance.md` accurate when porting
  upstream behavior or code.

## Completed: Basic Monitor Source

The monitor source lives in `monitor/monitor.asm`.

Current commands:

- `H`: help.
- `M`: memory dump.
- `S`: set memory bytes.
- `G`: run code with `JSR`.
- `R`: show registers saved after the last returned `G`.

See `docs/monitor.md` for the current user-facing documentation and ABI.

## Lovelace Status

The Lovelace language design is documented in
`docs/lovelace-language-design.md`.

The TypeScript compiler in `src/compiler/` has substantial implemented pieces:

- lexer,
- parser,
- semantic analysis,
- type checker,
- IR lowering,
- W65C832 assembly generation,
- assembler integration,
- CLI,
- runtime seed,
- emulator execution tests.

However, Lovelace should currently be treated as partial and experimental for
real machine development:

- `print()` is a runtime stub.
- memory helper built-ins are stubs.
- some language features compile to placeholder code.
- monitor-loadable output is not yet a first-class compiler target.

Before Lovelace becomes the main application language, it should gain a monitor
target:

- emit code for a documented load address,
- use monitor ABI conventions,
- return with `RTS` for monitor-launched programs,
- wire `print()` to `$F000` for the DragonFly monitor target.

Unsupported and placeholder behavior is documented in
`docs/lovelace-unsupported.md`.

## Future Milestones

### Disassembler

Not started.

### Lovelace VS Code Extension

Not started. It should reuse the compiler lexer/parser/diagnostics rather than
maintaining a separate language implementation.

### NeedleOS

Not started. It should begin after the bootable monitor computer and loader
workflow are real.

Initial areas:

- memory allocator,
- task scheduler,
- filesystem,
- interrupt handling,
- device drivers,
- shell.

### Lovelace Compiler V2

Not started. This is the self-hosting compiler written in Lovelace and compiled
by v1.

### SSH And Fly.io Deployment

Not started. These should come after the machine has a stable monitor, loader,
and program execution workflow.
