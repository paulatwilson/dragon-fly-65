# W65C832 Timing Metadata

## Cycle Count Sources

Base cycle counts follow the WDC W65C816 Programming Manual with extensions for W65C832 32-bit
modes. Where the FPGA core (`w65c832`) differs from the datasheet, the decision is documented
below.

## Conditional Adjustments

The emulator applies these cycle penalties at runtime:

| Condition | Penalty |
|-----------|---------|
| Accumulator is 16-bit (M=0) | +1 cycle |
| Accumulator is 32-bit (W65C832 native) | +3 cycles |
| Index register is 16-bit (X=0) | +1 cycle |
| Index register is 32-bit (W65C832 native) | +3 cycles |
| Direct page low byte (DL) is non-zero | +1 cycle |
| Branch taken | +1 cycle |
| Branch taken, page cross (emulation mode only) | +1 additional cycle |
| BRK/COP/IRQ/NMI/ABORT in native mode | +1 cycle over emulation base |

The 32-bit penalty (+3) is a DragonFly 65 design decision: three additional bus cycles are
required to fetch or write three extra bytes beyond the 8-bit base. The WDC W65C816 datasheet
does not define 32-bit operation, so this is an architectural extension.

## Non-Cycle-Perfect Areas

The following areas report approximate cycle counts and are not cycle-accurate:

### Block Moves (MVN, MVP)

Real hardware takes 7 cycles **per byte** transferred. The emulator transfers the entire block
in a single `step()` call and returns a fixed count of `7`. This is intentional to keep the
execution model simple. A cycle-accurate mode would require external clocking or a multi-step
transfer API.

### Read-Modify-Write Instructions (ASL, LSR, ROL, ROR, INC, DEC, TSB, TRB — memory forms)

The WDC W65C816 datasheet adds **+2** cycles for 16-bit memory RMW operations (one extra read
cycle and one extra write cycle). The W65C832 32-bit extension would add a further +4 (two more
read + two more write cycles). These extra cycles are **not yet applied** to the dp and absolute
forms of shift, rotate, increment, decrement, TSB, and TRB instructions. The accumulator forms
(e.g., `ASL A`) are not RMW and are cycle-correct.

Mark any trace output relying on RMW memory instruction timing as approximate.

### Stack-Relative Addressing

Stack-relative load and store cycle counts are approximate. The exact pipeline behaviour for
`s,r` addressing in 32-bit mode is not defined in any available reference.

### Interrupt Entry and Return (BRK, COP, RTI, IRQ, NMI, ABORT)

Cycle counts follow the W65C816 datasheet values (7 for emulation, 8 for native). The W65C832
native mode pushes an extra PRB byte, which is reflected in the native +1. The FPGA core has
not been audited for exact interrupt timing.

## Known FPGA Core Differences

| Area | Emulator behaviour | FPGA core | Decision |
|------|--------------------|-----------|----------|
| Decimal mode | Ignored (binary-only ADC/SBC) | Unknown | See `docs/processor-design.md` |
| Block move step granularity | Full block per step() | Byte per cycle | Documented above |
| 32-bit cycle penalties | DragonFly 65 design (+3/+6) | Not defined | DragonFly 65 extension |
