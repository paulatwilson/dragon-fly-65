# Dragon Fly 65

Dragon Fly 65 is a hypothetical computer based on the W65C832, written in TypeScript and designed to run on Bun and Fly.io.

The long-term goal is to build a network-accessible machine with SSH connections and a unique operating system of our own design.

## Status

Early project setup. The current codebase is a Bun + TypeScript foundation for the emulator, operating system services, and deployment work to grow from.

## Requirements

- Bun 1.3 or newer

## Getting Started

```sh
bun install
bun run dev
```

Run tests:

```sh
bun test
```

Run type checking:

```sh
bun run typecheck
```

## Open Source

Dragon Fly 65 is released under the MIT License. Contributions are welcome once the project direction and architecture settle.

## Reusable Emulator

The W65C832 emulator is being built as a standalone TypeScript library inside the project. Dragon Fly 65-specific machine, operating system, SSH, and deployment code should live outside the emulator boundary so other projects can reuse the processor model.

```ts
import { createCpu, createRam } from "dragon-fly-65/emulator";

const memory = createRam();
const cpu = createCpu({ memory });
cpu.step();
```

Dragon Fly 65 defaults the emulator to a fictional 1998-era 40 MHz W65C832 variant. The emulator enforces a minimum clock of 4 MHz and exposes WDC's 10 MHz value as a reference constant, but does not treat it as the DF65 ceiling.

## Credits

Dragon Fly 65 is informed by Michael Kohn's open-source projects:

- [W65C832 FPGA core](https://github.com/mikeakohn/w65c832), an important practical reference for building a W65C832-inspired processor.
- [naken_asm](https://github.com/mikeakohn/naken_asm), which will inform the direction of the Dragon Fly 65 W65C832 assembler work.
