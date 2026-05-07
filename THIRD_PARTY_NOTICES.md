# Third-Party Notices

DragonFly 65 is a GPL-3.0-licensed project. This file records upstream projects that inform
or may be used by DragonFly 65, along with their licenses and current use.

## Michael Kohn's W65C832 FPGA Core

- Project: <https://github.com/mikeakohn/w65c832>
- Author: Michael Kohn
- License: MIT
- Current use: architectural and behavioral reference for the W65C832 CPU emulator.

The W65C832 FPGA core is MIT licensed. MIT is compatible with GPL-3.0 — MIT-licensed code
may be included in a GPL-3.0 project provided the original copyright notice is preserved.
Any source files in DragonFly 65 that are ported or substantially derived from this core
must include Michael Kohn's copyright notice and a note referencing the upstream project.

## Michael Kohn's naken_asm

- Project: <https://github.com/mikeakohn/naken_asm>
- Author: Michael Kohn and contributors
- License: GPL-3.0
- Current use: assembler syntax, opcode encoding reference, and porting source for the
  DragonFly 65 W65C832 assembler.

Both `naken_asm` and DragonFly 65 are GPL-3.0 licensed, so code may be ported between them.
Any source files in DragonFly 65 that are ported or substantially derived from `naken_asm`
must preserve Michael Kohn's copyright notice, reference the upstream file path, and be noted
in this file when first introduced.

### Derived files

- `src/assembler/table.ts` — The 256-entry W65C816 opcode table (mnemonic, addressing mode,
  and opcode byte for each entry) is derived from `table/65816.cpp` and `table/65816.h` in
  `naken_asm`. Michael Kohn's copyright notice is preserved in the file header. The addressing
  mode enum and instruction mnemonic list follow the same structure as the upstream source.
  The TypeScript implementation is original; the data values are ported.
