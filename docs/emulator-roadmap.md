# Emulator Roadmap

This roadmap breaks the W65C832 emulator into small completion chunks. Each chunk should be finished, tested, and committed before moving to the next one.

The goal is to avoid large, long-lived branches and keep enough context in the repository that future work can resume cleanly.

## Rules

- Keep `src/emulator/` reusable and independent of Dragon Fly 65 machine, OS, SSH, and Fly.io code.
- Prefer original TypeScript structure. The MIT-licensed `w65c832` FPGA core may be used as a behavior reference or porting source with attribution.
- Do not copy GPL-3.0 `naken_asm` implementation code into the MIT emulator or assembler.
- Every chunk needs focused tests.
- When behavior differs between the WDC datasheet and the FPGA core, document the decision before implementing it.
- Keep chunks small enough that `bun test` and `bun run typecheck` remain the normal verification gate.

## Chunk 0: Foundation

Status: done.

Implemented:

- Reusable emulator module boundary.
- CPU state shape.
- Status flags.
- Clock metadata.
- Memory interface and RAM.
- 24-bit address helpers.
- Little-endian helpers.
- Width and mode resolution.
- Minimal `step()` support.
- `NOP`, `STP`, reset vector loading, and basic flag opcodes.

Definition of done:

- Tests cover reset shape, memory helpers, width resolution, clock config, `NOP`, `STP`, reset vector, and basic flag opcodes.

## Chunk 1: Execution Core Shape

Status: done.

Goal: make instruction execution scalable before adding many opcodes.

Tasks:

- Introduce an opcode metadata table.
- Define instruction names, byte lengths, base cycles, and handler functions.
- Add a trace/result shape that can include mnemonic, bytes read, effective address, and register changes.
- Keep unsupported opcode errors useful.

Definition of done:

- Existing opcodes are moved into the table.
- Tests confirm opcode metadata for implemented instructions.
- `step()` remains simple and readable.

## Chunk 2: Fetch Helpers And Immediate Addressing

Status: done.

Goal: make operand fetching width-aware.

Tasks:

- Add `fetchByte`, `fetchWord`, and `fetchLong`.
- Add immediate operand helpers for accumulator and index widths.
- Add tests for PC incrementing and banked program fetches.

Definition of done:

- Immediate fetch behavior works for 8-, 16-, and 32-bit values as applicable.
- Tests cover `PRB:PC` fetch addresses.

## Chunk 3: Load Instructions

Goal: implement the first useful register-mutating instructions.

Tasks:

- Implement `LDA`, `LDX`, and `LDY` immediate.
- Update `N` and `Z` flags according to active register width.
- Add width masking for destination registers.

Definition of done:

- Tests cover 8-, 16-, and 32-bit load widths.
- Tests cover `N` and `Z` flag behavior.

## Chunk 4: Store Instructions

Goal: write registers back to memory.

Tasks:

- Implement `STA`, `STX`, and `STY` for simple addressing modes first.
- Add write helpers for active accumulator and index widths.
- Decide the first address modes to support, preferably absolute and direct.

Definition of done:

- Tests prove byte order and width behavior for stores.
- Address construction is covered by tests.

## Chunk 5: Transfers And Register Operations

Goal: add instructions needed by simple monitor code.

Tasks:

- Implement core transfer instructions such as `TAX`, `TAY`, `TXA`, `TYA`, `TXS`, and `TSX`.
- Implement `INX`, `INY`, `DEX`, and `DEY`.
- Apply width masking and `N`/`Z` flag updates.

Definition of done:

- Tests cover all implemented transfer and increment/decrement instructions in multiple width modes.

## Chunk 6: Stack Basics

Goal: establish stack behavior before subroutines and interrupts.

Tasks:

- Add stack push and pull helpers.
- Implement `PHA`, `PLA`, `PHP`, and `PLP`.
- Verify W65C02 emulation stack page behavior.
- Verify native/W65C816 stack behavior as documented.

Definition of done:

- Tests cover stack addresses, wrapping, register restoration, and status restoration.

## Chunk 7: Branches And Jumps

Goal: support basic control flow.

Tasks:

- Implement relative branch offset calculation.
- Add condition branches such as `BEQ`, `BNE`, `BCC`, `BCS`, `BMI`, `BPL`, `BVC`, and `BVS`.
- Implement `JMP` absolute.

Definition of done:

- Tests cover forward and backward branches.
- Tests cover taken and not-taken branches.

## Chunk 8: Subroutines

Goal: support monitor-style code organization.

Tasks:

- Implement `JSR` and `RTS`.
- Implement long subroutine behavior later if needed: `JSL` and `RTL`.
- Verify return address conventions against the WDC datasheet and FPGA behavior.

Definition of done:

- Tests execute a small subroutine and return to caller.
- Stack contents are asserted.

## Chunk 9: ALU And Comparisons

Goal: add arithmetic and logical behavior.

Tasks:

- Implement `ADC`, `SBC`, `AND`, `ORA`, `EOR`.
- Implement `CMP`, `CPX`, and `CPY`.
- Decide decimal mode behavior before `ADC` and `SBC` are considered complete.

Definition of done:

- Tests cover carry, overflow, negative, and zero behavior.
- Decimal-mode choice is documented.

## Chunk 10: Addressing Modes

Goal: complete the addressing machinery.

Tasks:

- Direct.
- Direct indexed.
- Absolute.
- Absolute indexed.
- Long absolute.
- Indirect.
- Stack relative.
- Block move addressing support.

Definition of done:

- Addressing mode helpers are individually tested.
- Instruction tests reuse the helpers instead of re-testing every address mode for every opcode.

## Chunk 11: Mode Switching

Goal: implement `XCE`, `XFE`, `REP`, and `SEP`.

Tasks:

- Resolve the `XCE` discrepancy noted in `docs/processor-design.md`.
- Implement `REP` and `SEP`.
- Implement `XCE` and `XFE`.
- Enforce register masking when mode changes shrink register widths.

Definition of done:

- Tests cover W65C02, W65C816, and W65C832 mode transitions.
- The source discrepancy is resolved in docs.

## Chunk 12: Interrupts And Vectors

Goal: support reset, IRQ, NMI, BRK, COP, and ABORT behavior.

Tasks:

- Verify vector locations from the datasheet.
- Implement `BRK` first.
- Add interrupt entry and return helpers.
- Implement `RTI`.
- Add NMI, IRQ, COP, and ABORT behavior.

Definition of done:

- Tests cover vector selection, stack frame contents, and return behavior.

## Chunk 13: Coverage Pass For Opcode Families

Goal: fill in remaining opcode families systematically.

Tasks:

- Shifts and rotates.
- Bit tests.
- Read-modify-write instructions.
- Block moves.
- Push/pull variants.
- Long jumps and long addressing variants.

Definition of done:

- Opcode matrix marks implemented, unimplemented, and deliberately unsupported instructions.
- Tests cover at least one representative per family and edge cases for width-sensitive behavior.

## Chunk 14: Timing Metadata

Goal: add cycle metadata without forcing cycle-perfect execution too early.

Tasks:

- Add base cycle counts to opcode metadata.
- Add conditional cycle adjustments where behavior is known.
- Document known differences from the FPGA core.

Definition of done:

- Cycle counts are visible in traces.
- Tests cover simple known counts.
- Non-cycle-perfect areas are clearly marked.

## Chunk 15: Compatibility And Validation

Goal: prove the emulator can run real programs.

Tasks:

- Add small hand-authored assembly binary fixtures.
- Add fixtures inspired by the FPGA project demos where licensing permits.
- Later, compare assembler output and emulator traces with external tools.

Definition of done:

- A tiny monitor-like loop can run under the emulator.
- Test fixtures are documented and attributed.

## Chunk 16: Public API Hardening

Goal: make the emulator comfortable for other projects to embed.

Tasks:

- Review exported types.
- Add README examples for reset, stepping, memory injection, tracing, and clock config.
- Keep unstable internal APIs out of `src/emulator/index.ts`.

Definition of done:

- Public API is documented.
- External import smoke tests still pass.
