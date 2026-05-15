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
Monitor-resident mini assembler   started: `A` command handles a growing subset
Monitor-resident mini disassembler started: `D` matches the `A` subset
Native W65C832 assembler          phase 1 done, phase 2 planned below
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

## Completed: Monitor-Resident Mini Assembler Phase 1

The first native assembler is deliberately small. Its job is to make the
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

Phase 1 has grown beyond the initial Hello World subset. The monitor now has
native assembly/disassembly coverage for the completed chunks below.

## Native Assembler/Disassembler Growth

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

Completed phase 1 chunks:

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
```

Phase 2 should continue from the working monitor assembler and grow toward the
host TypeScript assembler's practical coverage. Keep chunks small. Each chunk
must update `monitor/monitor.asm`, monitor workflow tests, monitor docs, and
examples when the syntax is user-facing.

Phase 2 checklist:

- [x] Chunk N9: Clean up the roadmap.
  Remove stale duplicate chunks, mark phase 1 accurately, and make this phase 2
  checklist explicit.
- [x] Chunk N10: Add core implied and status instructions.
  Add `tax`, `tay`, `txa`, `tya`, `tsx`, `txs`, `inx`, `dex`, `iny`, `dey`,
  `clc`, `sec`, `cli`, `sei`, `clv`, `cld`, and `sed`.
  This expanded the monitor ROM window from `$E000-$FFFF` to `$C000-$FFFF`
  because the phase 1 monitor image already filled the old 8 KiB ROM.
- [x] Chunk N11: Finish `sta` direct page and indexed forms.
  Add `sta dp`, `sta dp,x`, `sta abs,x`, and `sta abs,y`.
  The monitor assembler and disassembler now cover the complete phase-2 `sta`
  direct page/indexed group, with parity test coverage.
- [x] Chunk N12: Add `lda` direct page and indexed forms.
  Add `lda dp`, `lda dp,x`, `lda abs,x`, and `lda abs,y`.
  The monitor assembler and disassembler now cover the complete phase-2 `lda`
  direct page/indexed group, with parity test coverage.
- [x] Chunk N13: Expand accumulator ALU addressing.
  For `cmp`, `and`, `ora`, `eor`, `adc`, and `sbc`, add `dp`, `dp,x`,
  `abs,x`, and `abs,y`.
  The monitor assembler and disassembler now cover direct page and indexed
  direct/absolute forms for the phase-2 accumulator ALU and compare group, with
  parity test coverage.
- [x] Chunk N14: Add `cpx` and `cpy`.
  Add `cpx #imm8`, `cpy #imm8`, `cpx dp`, `cpy dp`, `cpx abs`, and `cpy abs`.
  The monitor assembler and disassembler now cover the initial index-register
  compare forms, with parity test coverage.
- [x] Chunk N15: Add `bit`, `inc`, and `dec`.
  Add `bit #imm8`, `bit dp`, `bit abs`, `bit dp,x`, `bit abs,x`, plus
  `inc`/`dec` accumulator, direct page, absolute, and indexed forms.
  The monitor assembler and disassembler now cover the phase-2 BIT and
  increment/decrement memory groups, with parity test coverage.
- [x] Chunk N16: Add shifts and rotates.
  Add `asl`, `lsr`, `rol`, and `ror` accumulator, direct page, absolute, and
  indexed forms.
  The monitor assembler and disassembler now cover accumulator, direct page,
  absolute, and X-indexed shift/rotate forms, with parity test coverage.
- [x] Chunk N17: Add remaining short branches.
  Add `bra`, `bvc`, and `bvs` with absolute target syntax.
  The monitor assembler and disassembler now cover all 65C02 short branches,
  with parity test coverage.
- [x] Chunk N18: Add stack instructions.
  Add `pha`, `pla`, `php`, `plp`, `phx`, `plx`, `phy`, `ply`, `phb`, `plb`,
  `phd`, `pld`, and `phk`.
  The monitor assembler and disassembler now cover all W65C832 push and pull
  instructions, with parity test coverage.
- [x] Chunk N19: Add interrupt and machine-control instructions.
  Add `brk [#imm8]`, `rti`, `cop #imm8`, `wdm #imm8`, `wai`, and `stp`.
  The monitor assembler and disassembler now cover all W65C832 interrupt and
  machine-control instructions, with parity test coverage. Plain `brk` emits a
  zero signature byte so the assembled instruction matches emulator runtime
  length.
- [x] Chunk N20: Add more jump forms.
  Add `jmp (abs)`, `jmp (abs,x)`, `jmp [abs]`, and `jsr (abs,x)`.
  The monitor assembler and disassembler now cover the phase-2 indirect jump
  forms, with parity test coverage.
- [x] Chunk N21: Add native width directives.
  Add `.a8`, `.a16`, `.a32`, `.i8`, `.i16`, and `.i32`, and define how `D`
  renders width-sensitive immediates.
  The monitor assembler now supports native immediate-width directives, and
  `D` renders width-sensitive immediates from its disassembly state: default
  `.a8`/`.i8`, with 8/16-bit changes tracked from visible `sep`/`rep`
  instructions in the byte stream.
- [x] Chunk N22: Add word and string data directives.
  Add `.word`/`.dw`, `.long`/`.dl`, `.ascii`, `.asciiz`, `.resb`, and string
  literals in `.byte`/`db`.
  The monitor assembler now supports byte, word, long, string, NUL-terminated
  string, and reserve-byte data entry, with monitor test coverage.
- [x] Chunk N23: Improve symbol support.
  Add labels on instruction lines, `.equ` constants, larger or documented
  label/fixup limits, duplicate-label errors, and unresolved-label diagnostics.
  The monitor assembler now supports labels before instructions, `NAME .equ`
  constants, 16 compact symbol and fixup entries per `A` session, and specific
  `?DUP`, `?UNRES`, and `?TABLE` diagnostics.
- [x] Chunk N24: Add address force modifiers.
  Add `<expr` for direct page, `!expr` for absolute, and `>expr` for long.
  The monitor assembler now supports `<` direct-page and `!` absolute force
  modifiers across shared address operands and absolute jump operands. `>` is
  parsed as long-address selection and currently reports the expected generic
  unsupported-form error until N25 adds long opcodes.
- [ ] Chunk N25: Add long addressing.
  Add `lda long`, `sta long`, `lda long,x`, `sta long,x`, `jsl long`, and
  `jml long`.
- [ ] Chunk N26: Add indirect addressing.
  Add `(dp)`, `(dp,x)`, `(dp),y`, `[dp]`, `[dp],y`, then stack-relative
  `dp,s` and `(dp,s),y`.
- [ ] Chunk N27: Add block move instructions.
  Add `mvn src,dst` and `mvp src,dst`.
- [ ] Chunk N28: Keep the parity gate complete for every new group.
  For every chunk, assemble through `A`, disassemble through `D`, verify emitted
  bytes, run with `G` when meaningful, and update monitor docs/examples.

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
