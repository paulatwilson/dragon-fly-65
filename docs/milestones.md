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

Phase 2 should continue from the working monitor assembler and finish parity
with the host TypeScript assembler's practical W65C816/W65C832 opcode table.
Keep chunks small. Each chunk must update `monitor/monitor.asm`, monitor
workflow tests, monitor docs, and examples when the syntax is user-facing.

For this milestone, "finished" means:

- every non-reserved opcode in `src/assembler/table.ts`, plus the DragonFly
  `xfe` extension, can be assembled through monitor `A` and rendered through
  monitor `D`,
- source forms accepted by the host assembler have equivalent monitor syntax,
  except for explicitly documented monitor memory/table limits,
- every group has parity tests that assemble through `A`, disassemble through
  `D`, verify raw bytes, run through `G` when meaningful, and update
  `examples/asm/monitor-programs.md`,
- monitor docs describe the full supported syntax and remaining limits.

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
- [x] Chunk N25: Add long addressing.
  Add `lda long`, `sta long`, `lda long,x`, `sta long,x`, `jsl long`, and
  `jml long`.
- [x] Chunk N26: Add indirect addressing.
  Add `(dp)`, `(dp,x)`, `(dp),y`, `[dp]`, `[dp],y`, then stack-relative
  `dp,s` and `(dp,s),y`.
- [x] Chunk N27: Add block move instructions.
  Add `mvn src,dst` and `mvp src,dst`.
- [x] Chunk N28: Keep the parity gate complete for every new group.
  For every chunk, assemble through `A`, disassemble through `D`, verify emitted
  bytes, run with `G` when meaningful, and update monitor docs/examples.
  Added runnable parity coverage for meaningful long, indirect, and block-move
  forms, restored the stale `>` force-modifier example, and added example-file
  coverage checks so new user-facing groups cannot silently skip examples.
- [ ] Chunk N29: Refresh the opcode matrix against the monitor.
  Audit `docs/opcode-matrix.md` against the real monitor assembler and
  disassembler, update stale status marks, and make the matrix the tracking
  source for the remaining chunks below.
- [ ] Chunk N30: Add store-zero forms.
  Add `stz dp`, `stz dp,x`, `stz abs`, and `stz abs,x`.
- [ ] Chunk N31: Add test-and-set/reset bit forms.
  Add `tsb dp`, `tsb abs`, `trb dp`, and `trb abs`.
- [ ] Chunk N32: Finish indexed `bit`.
  Add any missing `bit dp,x` and `bit abs,x` monitor assembler/disassembler
  coverage, or mark the chunk complete after the N29 audit if coverage is
  already fully present.
- [ ] Chunk N33: Finish increment/decrement indexed memory.
  Add any missing `inc dp,x`, `inc abs,x`, `dec dp,x`, and `dec abs,x`
  coverage, or mark complete after the N29 audit if already fully present.
- [ ] Chunk N34: Finish shift/rotate indexed memory.
  Add any missing `asl dp,x`, `asl abs,x`, `lsr dp,x`, `lsr abs,x`,
  `rol dp,x`, `rol abs,x`, `ror dp,x`, and `ror abs,x` coverage, or mark
  complete after the N29 audit if already fully present.
- [ ] Chunk N35: Finish accumulator ALU long forms.
  Add `ora long`, `ora long,x`, `and long`, `and long,x`, `eor long`,
  `eor long,x`, `adc long`, `adc long,x`, `sbc long`, and `sbc long,x`.
- [ ] Chunk N36: Finish compare long forms.
  Add `cmp long` and `cmp long,x`.
- [ ] Chunk N37: Add 16-bit relative branch.
  Add `brl addr` with absolute target syntax, signed 16-bit fixups, and
  disassembly that prints the resolved absolute target.
- [ ] Chunk N38: Add stack operand instructions.
  Add `pea abs`, `pei (dp)`, and `per addr`. `per` should use absolute target
  syntax and emit a signed 16-bit program-counter-relative operand.
- [ ] Chunk N39: Add return-from-long-subroutine.
  Add `rtl` and a runnable `jsl`/`rtl` monitor example when meaningful in the
  current emulator model.
- [ ] Chunk N40: Add remaining transfer instructions.
  Add `tcs`, `tsc`, `tcd`, `tdc`, `txy`, and `tyx`, with run coverage for the
  safe register-transfer subset and parity-only coverage for stack/direct-page
  side-effect cases where needed.
- [ ] Chunk N41: Add remaining mode/exchange instructions.
  Add `xba`, `xce`, and DragonFly `xfe`. Document which forms are safe to run
  from monitor-launched programs and which are parity-only.
- [ ] Chunk N42: Finish `cpx`/`cpy` absolute audit.
  Ensure `cpx abs` and `cpy abs` are covered by monitor assembler,
  disassembler, docs, examples, and parity tests; mark complete immediately if
  N29 confirms the coverage is already complete.
- [ ] Chunk N43: Add full immediate-width parity.
  Ensure every width-sensitive immediate form supported by the host assembler
  has monitor coverage across `.a8`, `.a16`, `.a32`, `.i8`, `.i16`, `.i32`,
  and visible `rep`/`sep` width changes.
- [ ] Chunk N44: Add host assembler expression parity.
  Add the expression forms needed for host-compatible monitor operands:
  binary/hex/decimal literals, character literals, labels, `.equ` constants,
  unary address force modifiers, and simple arithmetic expressions if the host
  assembler supports them.
- [ ] Chunk N45: Add origin/alignment source-control directives.
  Add monitor equivalents for practical host directives such as `.org` if they
  make sense inside an `A` session; otherwise document why monitor assembly
  intentionally rejects them.
- [ ] Chunk N46: Raise or replace compact symbol/fixup limits.
  Replace one-byte-hash-only symbol matching with stored names, or document a
  hard final limit if the ROM budget makes full names impractical. The final
  monitor assembler should not silently reject common programs because of label
  hash collisions.
- [ ] Chunk N47: Add complete negative diagnostics.
  Add tests and docs for unsupported addressing modes, bad operands,
  out-of-range direct/absolute/long values, branch range failures, duplicate
  labels, unresolved symbols, table overflow, and unterminated strings.
- [ ] Chunk N48: Add generated monitor parity coverage.
  Build a table-driven test from `src/assembler/table.ts` that assembles every
  supported host opcode form through monitor `A`, disassembles through `D`, and
  verifies raw bytes and text. Keep hand-written `G` tests for meaningful
  runtime behavior.
- [ ] Chunk N49: Final monitor assembler documentation pass.
  Replace "current subset" language with the final syntax reference, update
  `docs/monitor.md`, `examples/asm/monitor-programs.md`,
  `docs/opcode-matrix.md`, and any README references.
- [ ] Chunk N50: Final ROM budget and workflow gate.
  Rebuild `monitor/monitor.bin`, verify it still fits the documented ROM
  window, run `bun test`, `bun run typecheck`, and a real `bun run monitor`
  smoke workflow that enters, disassembles, and runs a representative program.
- [ ] Chunk N51: Declare monitor assembler complete.
  Mark this phase complete only after N29-N50 are done. From this point, new
  monitor assembler work should be bug fixes or intentionally new architecture
  features, not catch-up parity with the host assembler.

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
