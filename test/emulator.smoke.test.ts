// Smoke tests for the public emulator API.
// Each test uses only names exported from src/emulator/index.ts — no internal paths.
// These mirror how an external embedder would use the library.

import { expect, test } from "bun:test";
import {
  createClockConfig,
  createCpu,
  createInitialCpuState,
  createRam,
  getOpcodeDefinition,
  hasStatusFlag,
  makeDataAddress,
  makeProgramAddress,
  maskForWidth,
  maskToWidth,
  NATIVE_BRK_VECTOR,
  OPCODES,
  readWord,
  RESET_VECTOR_ADDRESS,
  resolveWidthMode,
  StatusFlag,
  UnsupportedOpcodeError,
  WDC_MAX_CLOCK_HZ,
  WDC_MIN_CLOCK_HZ,
  writeWord,
} from "../src/emulator";
import type {
  AddressingMode,
  ByteMemory,
  ClockConfig,
  CpuMode,
  CpuOptions,
  CpuState,
  RegisterChange,
  StepResult,
  WidthMode,
} from "../src/emulator";

// --- Core construction -------------------------------------------------------

test("smoke: createRam returns a ByteMemory with readable and writable bytes", () => {
  const mem: ByteMemory = createRam(0x10000);
  mem.writeByte(0x1234, 0xab);
  expect(mem.readByte(0x1234)).toBe(0xab);
});

test("smoke: createCpu accepts a ByteMemory and optional clockHz", () => {
  const mem = createRam(256);
  const cpu = createCpu({ memory: mem, clockHz: 8_000_000 });
  expect(cpu.clock.hz).toBe(8_000_000);
});

test("smoke: createClockConfig validates the minimum frequency", () => {
  expect(() => createClockConfig(WDC_MIN_CLOCK_HZ - 1)).toThrow(RangeError);
  const clock: ClockConfig = createClockConfig(WDC_MIN_CLOCK_HZ);
  expect(clock.hz).toBe(WDC_MIN_CLOCK_HZ);
  expect(clock.mhz).toBe(4);
});

test("smoke: WDC_MAX_CLOCK_HZ is greater than WDC_MIN_CLOCK_HZ", () => {
  expect(WDC_MAX_CLOCK_HZ).toBeGreaterThan(WDC_MIN_CLOCK_HZ);
});

// --- Reset and PC loading ----------------------------------------------------

test("smoke: reset loads PC from the reset vector", () => {
  const mem = createRam(0x10000);
  const cpu = createCpu({ memory: mem });

  writeWord(mem, RESET_VECTOR_ADDRESS, 0x8000);
  cpu.reset();

  expect(cpu.readRegister("pc")).toBe(0x8000);
});

test("smoke: reset clears the stopped flag", () => {
  const mem = createRam(256);
  const cpu = createCpu({ memory: mem });

  mem.writeByte(0, 0xdb); // STP
  cpu.reset();
  cpu.step();

  expect(cpu.readRegister("stopped")).toBe(true);
  cpu.reset();
  expect(cpu.readRegister("stopped")).toBe(false);
});

// --- Stepping and StepResult -------------------------------------------------

test("smoke: step returns a well-formed StepResult", () => {
  const mem = createRam(256);
  const cpu = createCpu({ memory: mem });

  mem.writeByte(0, 0xea); // NOP
  cpu.reset();

  const result: StepResult = cpu.step();

  expect(result.mnemonic).toBe("NOP");
  expect(result.opcode).toBe(0xea);
  expect(result.bytes).toEqual([0xea]);
  expect(typeof result.pcBefore).toBe("number");
  expect(typeof result.pcAfter).toBe("number");
  expect(result.cycles).toBeGreaterThan(0);
  expect(result.stopped).toBe(false);
});

test("smoke: step throws UnsupportedOpcodeError for unimplemented opcodes", () => {
  const mem = createRam(256);
  const cpu = createCpu({ memory: mem });

  mem.writeByte(0, 0xff); // unimplemented
  cpu.reset();

  expect(() => cpu.step()).toThrow(UnsupportedOpcodeError);
});

test("smoke: registerChanges tracks mutated registers", () => {
  const mem = createRam(256);
  const cpu = createCpu({ memory: mem });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  mem.writeByte(0, 0xa9); // LDA #
  mem.writeByte(1, 0x55);
  cpu.reset();

  const result = cpu.step();
  const change: RegisterChange | undefined = result.registerChanges?.["a"];

  expect(change).toBeDefined();
  expect(change!.before).toBe(0);
  expect(change!.after).toBe(0x55);
});

// --- Register read/write -----------------------------------------------------

test("smoke: writeRegister and readRegister round-trip for all core registers", () => {
  const mem = createRam(256);
  const cpu = createCpu({ memory: mem });

  cpu.writeRegister("a", 0x1234);
  cpu.writeRegister("x", 0xabcd);
  cpu.writeRegister("y", 0x0042);
  cpu.writeRegister("sp", 0x01ff);
  cpu.writeRegister("pc", 0x8000);

  expect(cpu.readRegister("a")).toBe(0x1234);
  expect(cpu.readRegister("x")).toBe(0xabcd);
  expect(cpu.readRegister("y")).toBe(0x0042);
  expect(cpu.readRegister("sp")).toBe(0x01ff);
  expect(cpu.readRegister("pc")).toBe(0x8000);
});

// --- Mode and width resolution -----------------------------------------------

test("smoke: getWidthMode reports w65c02-emulation on reset", () => {
  const mem = createRam(256);
  const cpu = createCpu({ memory: mem });

  cpu.reset();
  const mode: WidthMode = cpu.getWidthMode();

  expect(mode.mode).toBe("w65c02-emulation");
  expect(mode.accumulator).toBe(8);
  expect(mode.index).toBe(8);
});

test("smoke: resolveWidthMode derives mode from raw CpuState", () => {
  const state: CpuState = createInitialCpuState();
  // W65C832 native 32-bit: e16=false, e8=true, M=0, X=0
  state.e8 = true;
  state.e16 = false;
  state.p &= ~(StatusFlag.Memory | StatusFlag.Index);

  const mode: WidthMode = resolveWidthMode(state);
  const cpuMode: CpuMode = mode.mode;

  expect(cpuMode).toBe("w65c832-native");
  expect(mode.accumulator).toBe(32);
});

// --- Status flag helpers -----------------------------------------------------

test("smoke: StatusFlag enum values are single-bit masks", () => {
  expect(StatusFlag.Carry).toBe(0x01);
  expect(StatusFlag.Zero).toBe(0x02);
  expect(StatusFlag.Negative).toBe(0x80);
});

test("smoke: hasStatusFlag reads a flag from a CpuState", () => {
  const state = createInitialCpuState();
  state.p = StatusFlag.Carry | StatusFlag.Zero;
  expect(hasStatusFlag(state, StatusFlag.Carry)).toBe(true);
  expect(hasStatusFlag(state, StatusFlag.Negative)).toBe(false);
});

// --- Mask utilities ----------------------------------------------------------

test("smoke: maskToWidth clamps values to the given register width", () => {
  expect(maskToWidth(0x1234_5678, 8)).toBe(0x78);
  expect(maskToWidth(0x1234_5678, 16)).toBe(0x5678);
  expect(maskToWidth(0x1234_5678, 32)).toBe(0x1234_5678);
});

test("smoke: maskForWidth returns the correct bitmask for each width", () => {
  expect(maskForWidth(8)).toBe(0xff);
  expect(maskForWidth(16)).toBe(0xffff);
  expect(maskForWidth(32)).toBe(0xffff_ffff);
});

// --- Address helpers ---------------------------------------------------------

test("smoke: makeDataAddress and makeProgramAddress form 24-bit addresses", () => {
  expect(makeDataAddress(0x01, 0x2345)).toBe(0x01_2345);
  expect(makeProgramAddress(0x02, 0x0100)).toBe(0x02_0100);
});

// --- Interrupt vectors -------------------------------------------------------

test("smoke: NATIVE_BRK_VECTOR is in bank 0 at the expected W65C816 location", () => {
  expect(NATIVE_BRK_VECTOR).toBe(0x00_ffe6);
});

// --- Opcode metadata ---------------------------------------------------------

test("smoke: OPCODES map is populated", () => {
  expect(OPCODES.size).toBeGreaterThan(100);
});

test("smoke: getOpcodeDefinition returns correct metadata for NOP", () => {
  const def = getOpcodeDefinition(0xea);

  expect(def).toBeDefined();
  expect(def!.mnemonic).toBe("NOP");
  expect(def!.cycles).toBe(2);
  const mode: AddressingMode = def!.addressingMode;
  expect(mode).toBe("implied");
});

// --- End-to-end run ----------------------------------------------------------

test("smoke: full program runs reset → step loop → stopped", () => {
  const mem = createRam(0x10000);
  const cpu = createCpu({ memory: mem });

  // LDA #1, LDA #2, STP
  const program = [0xa9, 0x01, 0xa9, 0x02, 0xdb];
  for (const [i, byte] of program.entries()) mem.writeByte(i, byte);
  writeWord(mem, RESET_VECTOR_ADDRESS, 0x0000);

  cpu.reset();

  const results: StepResult[] = [];
  while (!cpu.readRegister("stopped")) {
    results.push(cpu.step());
  }

  expect(results).toHaveLength(3);
  expect(results[0]!.mnemonic).toBe("LDA");
  expect(results[2]!.stopped).toBe(true);
  expect(cpu.readRegister("a")).toBe(2);

  const totalCycles = results.reduce((sum, r) => sum + r.cycles, 0);
  expect(cpu.readRegister("cycles")).toBe(totalCycles);
});

// --- CpuOptions type ---------------------------------------------------------

test("smoke: CpuOptions type is satisfied by { memory } alone", () => {
  const mem = createRam(256);
  const opts: CpuOptions = { memory: mem };
  const cpu = createCpu(opts);
  expect(cpu).toBeDefined();
});

// --- readWord helper ---------------------------------------------------------

test("smoke: readWord reads a little-endian 16-bit value from memory", () => {
  const mem = createRam(256);
  mem.writeByte(0x10, 0x34);
  mem.writeByte(0x11, 0x12);
  expect(readWord(mem, 0x10)).toBe(0x1234);
});
