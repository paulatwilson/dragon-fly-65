import { W65C832Cpu } from "../emulator/cpu";
import { writeWord } from "../emulator/memory";
import { MappedMemory } from "./memory";

export class Machine {
  readonly mem: MappedMemory;
  readonly cpu: W65C832Cpu;

  constructor() {
    this.mem = new MappedMemory();
    this.cpu = new W65C832Cpu({ memory: this.mem, clockHz: 40_000_000 });
  }

  // Load binary bytes into RAM at the given address.
  load(bytes: Uint8Array, address: number): void {
    for (let i = 0; i < bytes.length; i++) {
      this.mem.bytes[(address + i) & 0xffff] = bytes[i] ?? 0;
    }
  }

  // Point the reset vector ($FFFC–$FFFD) at an address.
  setResetVector(address: number): void {
    writeWord(this.mem, 0xfffc, address);
  }

  reset(): void {
    this.cpu.reset();
  }

  // Execute one instruction. Returns true if the CPU has stopped (STP).
  step(): boolean {
    return this.cpu.step().stopped;
  }

  pushInput(byte: number): void {
    this.mem.pushInput(byte);
  }

  // Run until STP, yielding to the event loop every 10 000 steps so that
  // async stdin data has a chance to fill the input queue.
  async run(): Promise<void> {
    while (true) {
      for (let i = 0; i < 10_000; i++) {
        if (this.step()) return;
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
}
