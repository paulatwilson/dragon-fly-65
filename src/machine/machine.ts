import { W65C832Cpu } from "../emulator/cpu";
import {
  MappedMemory,
  MONITOR_ROM_END,
  MONITOR_ROM_START,
} from "./memory";

export class Machine {
  readonly mem: MappedMemory;
  readonly cpu: W65C832Cpu;

  constructor() {
    this.mem = new MappedMemory();
    this.cpu = new W65C832Cpu({ memory: this.mem, clockHz: 40_000_000 });
  }

  // Load binary bytes into RAM at the given address.
  load(bytes: Uint8Array, address: number): void {
    this.assertWritableRange(address, bytes.length);
    this.mem.loadBytes(bytes, address);
  }

  loadMonitorRom(bytes: Uint8Array, address: number): void {
    const start = address & 0xffff;
    const end = (start + bytes.length - 1) & 0xffff;
    if (bytes.length === 0) return;
    if (start < MONITOR_ROM_START || end > MONITOR_ROM_END || end < start) {
      throw new RangeError(
        `Monitor ROM image must fit within $${hex4(MONITOR_ROM_START)}-$${hex4(MONITOR_ROM_END)}.`,
      );
    }
    this.mem.loadBytes(bytes, address);
  }

  // Point the reset vector ($FFFC–$FFFD) at an address.
  setResetVector(address: number): void {
    this.mem.loadBytes(new Uint8Array([address & 0xff, address >> 8]), 0xfffc);
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

  private assertWritableRange(address: number, length: number): void {
    if (length === 0) return;
    const start = address & 0xffff;
    const end = (start + length - 1) & 0xffff;
    if (end < start) {
      throw new RangeError("Cannot load a program across the 16-bit address boundary.");
    }
    for (let addr = start; addr <= end; addr++) {
      if (this.mem.isRomAddress(addr)) {
        throw new RangeError(
          `Cannot load program bytes into monitor ROM at $${hex4(addr)}.`,
        );
      }
    }
  }
}

function hex4(value: number): string {
  return (value & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}
