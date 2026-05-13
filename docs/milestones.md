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
  -> monitor-resident mini assembler
  -> monitor-resident mini disassembler
  -> native assembler/disassembler growth
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
Monitor can run in emulator       done
Bootable DragonFly computer       started: `bun run computer` boots monitor ROM
Monitor-resident mini assembler   started: `A` command handles a small subset
Monitor-resident mini disassembler started: `D` matches the `A` subset
Native W65C832 assembler          started in monitor, far from complete
Documented monitor                done for current monitor ABI
Assembly examples                 started: `examples/asm/monitor-programs.md`
Lovelace compiler v1              partial / experimental target
NeedleOS                          not started
Self-hosting Lovelace compiler    not started
Fly.io deployment                 not started
```

## Near-Term Milestone: Bootable Monitor Computer

Definition of done:

- `bun run computer` boots DragonFly 65 into the monitor.
- Monitor ROM is loaded at its documented ROM address.
- Reset vector is provided by the monitor ROM.
- User RAM is separate from monitor workspace and ROM.
- `docs/monitor.md` documents commands, memory map, and ABI.
- The monitor can accept assembly source through its own command interface,
  assemble a small instruction subset inside the running machine using W65C832
  code, and write bytes into RAM.
- The monitor can disassemble the same instruction subset from RAM.
- At least one assembly "Hello World" can be entered through monitor assembly
  mode, run with `G0300`, and observed through monitor output.
- Smoke tests cover booting the monitor, entering assembly through the monitor,
  running it, and verifying output or register state.

Suggested chunks:

```text
Chunk 1: Add computer entrypoint [done]
  bun run computer
  Boots the machine into monitor ROM.

Chunk 1A: Treat monitor as ROM [done]
  Load the monitor through a ROM path.
  Protect monitor ROM from normal machine writes.
  Keep program loads out of ROM.

Chunk 2: Finish monitor documentation
  docs/monitor.md
  commands, memory map, boot behavior, ABI.

Chunk 3: Add monitor assembly mode [done for first subset]
  Add an A command or equivalent.
  Accept assembly text through the monitor interface.
  Assemble into RAM from an address chosen inside the monitor session.
  Implement this as a small W65C832 assembly mini assembler, not as a host
  TypeScript assembler call.

Chunk 3A: Add monitor disassembly mode [done for first subset]
  Add a D command or equivalent.
  Disassemble the same opcode subset supported by A.
  Keep A and D in lockstep as native assembler coverage grows.

Chunk 4: Add assembly examples [started]
  examples/asm/monitor-programs.md
  Record monitor-entered source, D output, G command, and expected result.

Chunk 5: Add smoke tests
  boot monitor
  enter asm through monitor
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

The host cross-assembler lives in `src/assembler/`.

Completed capabilities include:

- Two-pass cross-assembler.
- Full W65C816 + W65C832 opcode table.
- Directives: `.org`, `.db`, `.dw`, `.dl`, `.ascii`, `.asciiz`, `.resb`,
  `.equ`, `.65816`, `.65832`, `.a8`, `.a16`, `.a32`, `.i8`, `.i16`, `.i32`.
- Address auto-selection with `<`, `!`, and `>` force modifiers.
- Forward label resolution.
- REP/SEP width tracking for immediate operand encoding.
- CLI and REPL via `bun run asm`.

This assembler is still useful for building ROMs, tests, and cross-development,
but it is not the monitor assembly mode. Real computer operation requires an
assembler that runs on the DragonFly 65 side.

## Planned: Monitor-Resident Mini Assembler

The first native assembler should be deliberately small. Its job is to make the
computer usable from its own monitor, not to match the full TypeScript assembler
immediately.

Initial target workflow:

```text
* A0300
0300> lda #'H'
0302> sta $F000
0305> lda #'I'
0307> sta $F000
030A> rts
030B> end
OK
* G0300
HI
Returned
*
```

Initial instruction subset:

- `lda #imm8`
- `sta abs`
- `rts`
- `nop`
- `sep #imm8`
- `rep #imm8`
- optionally `jsr abs` and `jmp abs` once the basic path works

Initial parser scope:

- one source line at a time,
- case-insensitive mnemonics,
- immediate byte values as decimal, hex (`$41`), or character literals (`'A'`),
- absolute 16-bit addresses as hex (`$F000`),
- backward labels on label-only lines,
- forward references through a small fixup table,
- no directives except an explicit end marker for assembly mode.

The monitor also has a matching `D` command that disassembles the same subset
from RAM. As this grows, assembler and disassembler support must stay in
lockstep.

After this works, grow toward real native assembler/disassembler coverage in
small, testable chunks.

## Planned: Native Assembler/Disassembler Growth

The monitor assembler and monitor disassembler are one feature. Do not add
assembly support for an opcode unless the same change also adds disassembly
support and tests for it.

Each chunk should include:

- monitor assembly support,
- monitor disassembly support,
- at least one monitor workflow test that enters source through `A`,
  disassembles it with `D`, and runs it with `G` when the instruction group is
  executable in a small program,
- documentation updates for supported syntax.

Suggested order:

```text
Chunk N1: Accumulator immediate operations [done]
  Add cmp #imm8, and #imm8, ora #imm8, eor #imm8, adc #imm8, sbc #imm8.
  Test parsing for hex, decimal, and character immediates where useful.
  Test disassembly renders the same mnemonic and immediate value.

Chunk N2: Accumulator absolute operations [done]
  Add lda abs, cmp abs, and abs, ora abs, eor abs, adc abs, sbc abs.
  Keep syntax to 16-bit absolute addresses first.
  Test against RAM locations written through S or earlier assembled code.

Chunk N3: Relative branches with absolute target syntax [done]
  Add beq addr, bne addr, bcc addr, bcs addr, bmi addr, bpl addr.
  The monitor assembler accepts absolute target addresses and emits relative
  offsets.
  The monitor disassembler prints resolved absolute targets, not raw offsets.
  Test forward and backward branch distances that fit in signed 8-bit range.

Chunk N4: Byte data entry [done]
  Add .byte or db.
  Support hex bytes, decimal bytes, and character literals.
  Test data can be inspected with M and disassembled as DB when it is not code.

Chunk N5: Backward labels [done]
  Add simple labels that can be referenced after definition.
  Label definitions are label-only lines, references must point backward, and
  labels are scoped to one A session. The first implementation uses a small
  eight-entry native label table.

Chunk N6: Forward labels and fixups [done]
  Add a small fixup table for labels referenced before definition.
  Reject unresolved labels with a clear monitor error.
  Reject out-of-range branches clearly.

Chunk N7: Index register load/store forms [done]
  Make width rules explicit for native assembly mode. The first implementation
  emits one-byte index immediates, supports direct page and absolute addressing
  for ldx, ldy, stx, and sty, and supports the legal X/Y indexed forms for that
  register family.

Chunk N8: Native assembler/disassembler parity tests [done]
  Add an explicit monitor test gate that assembles each completed native
  assembler chunk, disassembles it with D, and checks the emitted bytes and
  disassembly text stay in sync.

Chunk N7: More load/store forms
  Add ldx, ldy, stx, sty, direct page, and indexed addressing only after width
  rules are explicit in docs and tests.
  Avoid guessing W65C832-specific width behavior; document any DragonFly-specific
  simplification.
```

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

Not started. It should begin after the bootable monitor computer and monitor
assembly workflow are real.

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

Not started. These should come after the machine has a stable monitor,
in-monitor assembly, and program execution workflow.
