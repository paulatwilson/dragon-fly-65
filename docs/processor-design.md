# Processor Design

This document records the processor direction for Dragon Fly 65. The aim is to build a TypeScript model of a W65C832-inspired computer that can run under Bun, host our own operating system, and expose interactive access over SSH.

## Sources

- WDC preliminary datasheet: `docs/wdc_w65c832_preliminary_mar_1991.pdf`
- Mike Kohn FPGA core: <https://github.com/mikeakohn/w65c832>
- Mike Kohn project notes: <https://www.mikekohn.net/micro/w65c832_fpga.php>

The WDC datasheet is the architectural reference. Mike Kohn's FPGA core is the practical implementation reference. When the two disagree, Dragon Fly 65 should document the disagreement before choosing behavior.

## Implementation Stance

Dragon Fly 65 is not an FPGA implementation. It is a software computer and operating environment. The processor model should therefore be deterministic, inspectable, and testable before it is cycle-perfect.

Initial implementation priorities:

- Correct register width behavior.
- Correct addressing and bank behavior.
- A clear opcode dispatch table.
- Repeatable execution traces for tests and debugging.
- Documented deviations from WDC or FPGA behavior.

Cycle timing can be introduced later as a separate concern once functional behavior is stable.

## Reusable Library Boundary

The W65C832 emulator must remain useful outside Dragon Fly 65. It should be possible for another TypeScript project to import the CPU, provide memory, step instructions, and inspect state without depending on DF65/OS, the SSH server, Fly.io deployment code, or Bun-specific server APIs.

Project boundaries:

- `src/emulator/`: reusable W65C832 CPU, state, memory interfaces, opcode logic, and tests.
- `src/assembler/`: reusable W65C832 assembler work, when introduced.
- `src/machine/`: Dragon Fly 65 hardware profile and memory map.
- `src/os/`: DF65/OS work.
- `src/server/`: SSH, HTTP, and deployment entry points.

The emulator may use TypeScript and standard JavaScript APIs. It should avoid direct dependencies on Bun runtime APIs unless a Bun-specific adapter is kept outside `src/emulator/`.

## Clock Configuration

The WDC datasheet describes 4 MHz to 10 MHz parts. Dragon Fly 65 deliberately models a fictional 1998-era 40 MHz variant.

Emulator clock rules:

- Minimum accepted CPU clock: 4 MHz.
- WDC reference maximum: 10 MHz.
- Dragon Fly 65 default clock: 40 MHz.
- Clock speed is configuration data, not real-time pacing. Instruction execution still advances by emulator steps and cycle counts.

The reusable emulator should expose clock metadata without coupling itself to a scheduler. Any real-time throttling, wall-clock pacing, or SSH session timing belongs outside `src/emulator/`.

## Register Model

The core CPU state should include:

- `A`: accumulator, operating as 8, 16, or 32 bits depending on mode.
- `X`: index register, operating as 8, 16, or 32 bits depending on mode.
- `Y`: index register, operating as 8, 16, or 32 bits depending on mode.
- `SP`: 16-bit stack pointer.
- `PC`: 16-bit program counter.
- `DR`: 16-bit direct register for direct page addressing.
- `DRB`: 8-bit data bank register.
- `PRB`: 8-bit program bank register.
- `P`: 8-bit processor status register.
- `E8`: emulation mode bit associated with W65C02/W65C816 behavior.
- `E16`: emulation mode bit associated with W65C832/W65C816 behavior.

The processor status register layout is:

```text
P = { N, V, M, X, D, I, Z, C }
```

Where:

- `N`: negative
- `V`: overflow
- `M`: memory/accumulator width select
- `X`: index width select, or break state in W65C02 emulation
- `D`: decimal mode
- `I`: interrupt disable
- `Z`: zero
- `C`: carry

## Width And Mode Rules

`M` controls accumulator and memory fetch width. `X` controls `X` and `Y` width. `E8` and `E16` select the broad CPU mode.

The Mike Kohn FPGA notes describe the startup state as all mode flags set. That means the software model should boot in W65C02 emulation until reset behavior is specified in more detail.

Mode table:

| E16 | E8 | M | X | A width | X/Y width | Mode |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 16 | 32 | W65C832 native |
| 0 | 0 | 0 | 1 | 16 | 8 | W65C832 native |
| 0 | 0 | 1 | 0 | 8 | 32 | W65C832 native |
| 0 | 0 | 1 | 1 | 8 | 8 | W65C832 native |
| 0 | 1 | 0 | 0 | 32 | 32 | W65C832 native |
| 0 | 1 | 0 | 1 | 32 | 8 | W65C832 native |
| 0 | 1 | 1 | 0 | 8 | 32 | W65C832 native |
| 0 | 1 | 1 | 1 | 8 | 8 | W65C832 native |
| 1 | 0 | 0 | 0 | 16 | 16 | W65C816 emulation |
| 1 | 0 | 0 | 1 | 16 | 8 | W65C816 emulation |
| 1 | 0 | 1 | 0 | 8 | 16 | W65C816 emulation |
| 1 | 0 | 1 | 1 | 8 | 8 | W65C816 emulation |
| 1 | 1 | 1 | break | 8 | 8 | W65C02 emulation |

## Mode Switching

The WDC datasheet states that `XCE` exchanges carry with `E8`, and that `XFE` exchanges `E8` and `E16` with carry and overflow.

There is a source discrepancy to resolve before implementation:

- The GitHub README shows `clc; clv; xce` for entering 65C832 mode from W65C816 mode.
- Mike Kohn's project page shows `sec; clv; xce` for the same transition.

Dragon Fly 65 must not encode this behavior until we verify the intended operation from the datasheet, the FPGA Verilog, or a focused executable test.

## Addressing Model

The CPU has a 16-bit `PC` extended by `PRB` for 24-bit program addressing. Data movement uses `DRB` for banked data addressing. The datasheet describes 24-bit external address availability, while noting broader 32-bit data-space ambitions for ASIC use.

Initial Dragon Fly 65 memory should expose a simple 24-bit address space:

- Address type: unsigned 24-bit integer.
- Address range: `0x000000` to `0xffffff`.
- Reads and writes are byte-oriented.
- Wider values are composed little-endian from byte reads and writes.

This gives us a stable base for the CPU and OS. Later we can layer bank paging, memory-mapped devices, and Fly-hosted persistence on top.

## FPGA Core Notes

Mike Kohn's FPGA implementation is an important reference because it proves a practical W65C832-like system can run demos and interact with peripherals.

Useful implementation ideas:

- A compact RAM/ROM/peripheral bank split.
- UART mapped into peripheral memory.
- Test programs assembled with `naken_asm`.
- SD card or flash style paged backing storage.

Known FPGA-core differences from the WDC spec, from the project notes:

- Instruction timings do not match the spec.
- Decimal mode is not implemented.
- W65C02 emulation allows newer instructions to work.

Dragon Fly 65 should decide explicitly whether to follow WDC behavior or FPGA behavior for each of these.

## Testing Strategy

Processor work should be test-first where possible.

Start with small tests for:

- Reset state.
- Status flag packing and unpacking.
- Register width masking.
- `M`, `X`, `E8`, and `E16` width resolution.
- Little-endian memory reads and writes.
- Address construction with `PRB`, `DRB`, and `DR`.
- A small initial opcode set, beginning with flag operations and simple loads.

As the emulator grows, tests should include execution traces that show:

- Initial CPU state.
- Bytes fetched.
- Effective addresses.
- Register changes.
- Status flag changes.
- Cycle count, once timing exists.

## Open Decisions

- Whether Dragon Fly 65 should emulate WDC decimal mode or follow the FPGA core's current lack of decimal support.
- Whether W65C02 emulation should reject newer instructions or allow them as the FPGA core does.
- Whether the first memory map should mirror the FPGA bank map or use a simpler software-native map.
- How exact cycle timing needs to be for the first operating system milestone.
- Whether to vendor, submodule, or merely reference the FPGA core.
