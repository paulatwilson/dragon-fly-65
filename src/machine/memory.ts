import type { ByteMemory } from "../emulator/types";

// Memory map
// $0000–$DFFF  RAM  (programs and data)
// $E000–$FFFF  monitor ROM, with an I/O hole at $F000-$F002
// $F000        CHAR_OUT  write: send byte to terminal
// $F001        CHAR_IN   read: next byte from terminal (0xFF if empty)
// $F002        CHAR_STS  read: 1 if input is available, 0 otherwise

export const CHAR_OUT = 0xf000;
export const CHAR_IN  = 0xf001;
export const CHAR_STS = 0xf002;
export const MONITOR_ROM_START = 0xe000;
export const MONITOR_ROM_END = 0xffff;

export class MappedMemory implements ByteMemory {
  readonly bytes = new Uint8Array(0x10000); // 64 KB bank 0
  private inputQueue: number[] = [];

  pushInput(byte: number): void {
    this.inputQueue.push(byte & 0xff);
  }

  readByte(address: number): number {
    const addr = address & 0xffff;
    if (addr === CHAR_IN)  return this.inputQueue.shift() ?? 0xff;
    if (addr === CHAR_STS) return this.inputQueue.length > 0 ? 1 : 0;
    return this.bytes[addr] ?? 0;
  }

  writeByte(address: number, value: number): void {
    const addr  = address & 0xffff;
    const byte  = value & 0xff;
    if (addr === CHAR_OUT) {
      process.stdout.write(String.fromCharCode(byte));
      return;
    }
    if (this.isRomAddress(addr)) return;
    this.bytes[addr] = byte;
  }

  loadBytes(bytes: Uint8Array, address: number): void {
    for (let i = 0; i < bytes.length; i++) {
      this.bytes[(address + i) & 0xffff] = bytes[i] ?? 0;
    }
  }

  isRomAddress(address: number): boolean {
    const addr = address & 0xffff;
    return addr >= MONITOR_ROM_START && addr <= MONITOR_ROM_END;
  }
}
