# Third-Party Notices

DragonFly 65 is an MIT-licensed project. This file records upstream projects that inform or may be used by DragonFly 65.

## Michael Kohn's W65C832 FPGA Core

- Project: <https://github.com/mikeakohn/w65c832>
- Author: Michael Kohn
- License: MIT
- Current use in DragonFly 65: architectural and behavioral reference.

The W65C832 FPGA core may be used as reference material for the TypeScript emulator. If DragonFly 65 ports, adapts, or copies any substantial portion of that implementation, the relevant source files must clearly preserve Michael Kohn's copyright and MIT license notice.

## Michael Kohn's naken_asm

- Project: <https://github.com/mikeakohn/naken_asm>
- Author: Michael Kohn and contributors
- License: GPL-3.0
- Current use in DragonFly 65: assembler syntax, behavior, and compatibility reference only.

Do not copy, port, or translate `naken_asm` source code into the MIT-licensed DragonFly 65 codebase. If we later choose to include GPL-derived assembler code, it must be isolated and documented as GPL-licensed work, and the project licensing strategy must be revisited before distribution.

