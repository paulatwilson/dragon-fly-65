import type { RegisterWidth } from "./constants";

export interface ByteMemory {
  readByte(address: number): number;
  writeByte(address: number, value: number): void;
}

export interface CpuState {
  a: number;
  x: number;
  y: number;
  sp: number;
  pc: number;
  dr: number;
  drb: number;
  prb: number;
  p: number;
  e8: boolean;
  e16: boolean;
  stopped: boolean;
  cycles: number;
}

export type RegisterName =
  | "a"
  | "x"
  | "y"
  | "sp"
  | "pc"
  | "dr"
  | "drb"
  | "prb"
  | "p"
  | "e8"
  | "e16"
  | "stopped"
  | "cycles";

export type CpuMode =
  | "w65c832-native"
  | "w65c816-emulation"
  | "w65c02-emulation";

export interface WidthMode {
  accumulator: RegisterWidth;
  index: RegisterWidth;
  mode: CpuMode;
}

export interface StepResult {
  pcBefore: number;
  opcode: number;
  cycles: number;
  stopped: boolean;
}

export interface CpuOptions {
  memory: ByteMemory;
  clockHz?: number;
}
