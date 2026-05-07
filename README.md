# DragonFly 65

DragonFly 65 is a hypothetical computer based on the W65C832, written in TypeScript and
designed to run on Bun and Fly.io.

The long-term goal is to build a network-accessible machine with SSH connections and a unique
operating system of our own design.

## Status

The W65C832 CPU emulator is complete. It supports the full W65C816 instruction set plus W65C832
32-bit extensions, all addressing modes, interrupts, mode switching, and conditional cycle
counting. Chunk 15 validates it against hand-authored binary fixtures including a monitor-style
dispatch loop.

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

## Emulator API

The W65C832 emulator lives in `src/emulator/` and is designed to be embedded in other
TypeScript projects without pulling in any DragonFly 65 machine, OS, SSH, or Fly.io code.

### Setup

```typescript
import {
  createCpu,
  createRam,
  writeWord,
  RESET_VECTOR_ADDRESS,
  StatusFlag,
} from "./src/emulator";

// Create 64 KB of byte-addressable RAM
const memory = createRam(0x10000);

// Create the CPU (default clock: 4 MHz minimum per WDC datasheet)
const cpu = createCpu({ memory });

// Optional: configure a specific clock speed
const cpu40mhz = createCpu({ memory, clockHz: 40_000_000 });
console.log(cpu40mhz.clock.mhz);               // 40
console.log(cpu40mhz.clock.nanosecondsPerCycle); // 25
```

### Memory Injection

```typescript
import { writeWord, RESET_VECTOR_ADDRESS } from "./src/emulator";

// Write a small program at address 0x0000
const program = [
  0xa9, 0x42,  // LDA #0x42
  0x85, 0x10,  // STA dp 0x10
  0xdb,        // STP
];
for (const [i, byte] of program.entries()) {
  memory.writeByte(i, byte);
}

// Point the reset vector at the program start
writeWord(memory, RESET_VECTOR_ADDRESS, 0x0000);
```

### Reset

```typescript
// reset() loads PC from the reset vector and returns all registers to their
// power-on state (W65C02 emulation mode, stack at 0x01FF, M=1 X=1 I=1).
cpu.reset();
```

### Stepping

```typescript
import type { StepResult } from "./src/emulator";

// Execute one instruction and inspect the result
const result: StepResult = cpu.step();

console.log(result.mnemonic);        // "LDA"
console.log(result.opcode);          // 0xa9
console.log(result.bytes);           // [0xa9, 0x42]
console.log(result.cycles);          // 2 (8-bit mode), 3 (16-bit), 5 (32-bit)
console.log(result.pcBefore);        // 0x000000
console.log(result.pcAfter);         // 0x000002
console.log(result.effectiveAddress); // set for memory-accessing instructions
console.log(result.registerChanges); // { a: { before: 0, after: 0x42 }, p: { ... } }
```

### Tracing

```typescript
// Step until the CPU halts (STP), collecting a trace
const trace: StepResult[] = [];

while (!cpu.readRegister("stopped")) {
  trace.push(cpu.step());
}

// Print an instruction trace
for (const step of trace) {
  const addr = step.pcBefore.toString(16).padStart(6, "0");
  const hex  = step.bytes.map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`${addr}  ${hex.padEnd(10)}  ${step.mnemonic}  (${step.cycles} cyc)`);
}
// 000000  a9 42       LDA  (2 cyc)
// 000002  85 10       STA  (3 cyc)
// 000004  db          STP  (3 cyc)

// Total cycle count
console.log(cpu.readRegister("cycles")); // 8
```

### Mode Switching

```typescript
import { resolveWidthMode } from "./src/emulator";
import type { WidthMode } from "./src/emulator";

// Check the current CPU mode and active register widths
const { mode, accumulator, index }: WidthMode = cpu.getWidthMode();
// mode:        "w65c02-emulation" | "w65c816-emulation" | "w65c832-native"
// accumulator: 8 | 16 | 32
// index:       8 | 16 | 32

// Switch to W65C816 native mode programmatically (bypasses XCE opcode):
cpu.writeRegister("e8", false);
cpu.writeRegister("e16", true);
cpu.writeRegister("p", 0x00); // M=0, X=0 → 16-bit accumulator and index

// Switch to W65C832 32-bit mode:
cpu.writeRegister("e8", true);
cpu.writeRegister("e16", false);
cpu.writeRegister("p", 0x00); // M=0, X=0 → 32-bit accumulator and index
```

### Status Flags

```typescript
import { StatusFlag, hasStatusFlag } from "./src/emulator";

// Read a flag from the current CPU state
const state = cpu.readRegister; // via readRegister("p")
const p = cpu.readRegister("p") as number;
const carrySet = (p & StatusFlag.Carry) !== 0;

// Or use hasStatusFlag with a full CpuState snapshot:
import { createInitialCpuState } from "./src/emulator";
const snapshot = createInitialCpuState();
hasStatusFlag(snapshot, StatusFlag.Memory); // true (reset default)
```

### Interrupts

```typescript
// Trigger hardware interrupts from outside the emulator
cpu.triggerIrq();   // maskable IRQ
cpu.triggerNmi();   // non-maskable NMI
cpu.triggerAbort(); // ABORT signal
```

### Opcode Inspection

```typescript
import { getOpcodeDefinition, OPCODES } from "./src/emulator";

// Look up metadata for a specific opcode
const def = getOpcodeDefinition(0xea); // NOP
console.log(def?.mnemonic);        // "NOP"
console.log(def?.cycles);          // 2
console.log(def?.addressingMode);  // "implied"

// Iterate all implemented opcodes
for (const [opcode, def] of OPCODES) {
  console.log(`0x${opcode.toString(16).padStart(2, "0")}  ${def.mnemonic}`);
}
```

## Open Source

DragonFly 65 is released under the GNU General Public License v3.0 (GPL-3.0). Contributions
are welcome once the project direction and architecture settle.

Third-party attribution and license notes are tracked in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Credits

DragonFly 65 is informed by Michael Kohn's open-source projects:

- [W65C832 FPGA core](https://github.com/mikeakohn/w65c832), an important practical reference
  for building a W65C832-inspired processor.
- [naken_asm](https://github.com/mikeakohn/naken_asm), which will inform the direction of the
  DragonFly 65 W65C832 assembler work. `naken_asm` is GPL-3.0 licensed, so DragonFly 65 treats
  it as a compatibility and porting reference. DragonFly 65 is GPL-3.0, so naken_asm-derived
  assembler code may be incorporated with proper attribution.
