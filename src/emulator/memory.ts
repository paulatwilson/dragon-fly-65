import { ADDRESS_MASK, BYTE_MASK, WORD_MASK } from "./constants";
import type { ByteMemory } from "./types";

export class Ram implements ByteMemory {
  readonly bytes: Uint8Array;

  constructor(size = ADDRESS_MASK + 1) {
    if (!Number.isInteger(size) || size <= 0 || size > ADDRESS_MASK + 1) {
      throw new RangeError("RAM size must be between 1 byte and 16 MiB");
    }

    this.bytes = new Uint8Array(size);
  }

  readByte(address: number): number {
    return this.bytes[normalizeAddress(address) % this.bytes.length] ?? 0;
  }

  writeByte(address: number, value: number): void {
    this.bytes[normalizeAddress(address) % this.bytes.length] = value & BYTE_MASK;
  }
}

export function createRam(size?: number): Ram {
  return new Ram(size);
}

export function normalizeAddress(address: number): number {
  if (!Number.isInteger(address)) {
    throw new RangeError("Address must be an integer");
  }

  return address & ADDRESS_MASK;
}

export function readWord(memory: ByteMemory, address: number): number {
  const low = memory.readByte(address);
  const high = memory.readByte(address + 1);

  return ((high << 8) | low) & WORD_MASK;
}

export function writeWord(
  memory: ByteMemory,
  address: number,
  value: number,
): void {
  memory.writeByte(address, value);
  memory.writeByte(address + 1, value >> 8);
}

export function readLong(memory: ByteMemory, address: number): number {
  const byte0 = memory.readByte(address);
  const byte1 = memory.readByte(address + 1);
  const byte2 = memory.readByte(address + 2);
  const byte3 = memory.readByte(address + 3);

  return (
    (byte0 |
      (byte1 << 8) |
      (byte2 << 16) |
      (byte3 << 24)) >>>
    0
  );
}

export function writeLong(
  memory: ByteMemory,
  address: number,
  value: number,
): void {
  const normalized = value >>> 0;

  memory.writeByte(address, normalized);
  memory.writeByte(address + 1, normalized >> 8);
  memory.writeByte(address + 2, normalized >> 16);
  memory.writeByte(address + 3, normalized >> 24);
}

export function makeProgramAddress(prb: number, pc: number): number {
  return (((prb & BYTE_MASK) << 16) | (pc & WORD_MASK)) & ADDRESS_MASK;
}

export function makeDataAddress(drb: number, address: number): number {
  return (((drb & BYTE_MASK) << 16) | (address & WORD_MASK)) & ADDRESS_MASK;
}

export function makeDirectAddress(dr: number, offset: number): number {
  return ((dr & WORD_MASK) + (offset & BYTE_MASK)) & WORD_MASK;
}
