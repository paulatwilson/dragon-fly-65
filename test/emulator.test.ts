import { expect, test } from "bun:test";
import {
  createClockConfig,
  createCpu,
  createInitialCpuState,
  createRam,
  DF65_DEFAULT_CLOCK_HZ,
  makeDataAddress,
  makeDirectAddress,
  makeProgramAddress,
  maskToWidth,
  readLong,
  readWord,
  resolveWidthMode,
  StatusFlag,
  writeLong,
  writeWord,
} from "../src/emulator";

test("clock config defaults to the DF65 40 MHz variant", () => {
  const clock = createClockConfig();

  expect(clock.hz).toBe(DF65_DEFAULT_CLOCK_HZ);
  expect(clock.mhz).toBe(40);
  expect(clock.nanosecondsPerCycle).toBe(25);
});

test("clock config rejects frequencies below 4 MHz", () => {
  expect(() => createClockConfig(3_999_999)).toThrow(RangeError);
});

test("initial CPU state boots in W65C02 emulation shape", () => {
  const state = createInitialCpuState();

  expect(state.e8).toBe(true);
  expect(state.e16).toBe(true);
  expect(state.sp).toBe(0x01ff);
  expect(state.p & StatusFlag.Memory).toBe(StatusFlag.Memory);
  expect(state.p & StatusFlag.Index).toBe(StatusFlag.Index);
});

test("resolves W65C832 native 32-bit accumulator and index mode", () => {
  const state = createInitialCpuState();
  state.e16 = false;
  state.e8 = true;
  state.p &= ~(StatusFlag.Memory | StatusFlag.Index);

  expect(resolveWidthMode(state)).toEqual({
    accumulator: 32,
    index: 32,
    mode: "w65c832-native",
  });
});

test("masks values to active register widths", () => {
  expect(maskToWidth(0x1234_5678, 8)).toBe(0x78);
  expect(maskToWidth(0x1234_5678, 16)).toBe(0x5678);
  expect(maskToWidth(0x1234_5678, 32)).toBe(0x1234_5678);
});

test("RAM reads and writes bytes with 24-bit address wrapping", () => {
  const ram = createRam(16);

  ram.writeByte(0x00ff_ffff, 0xab);

  expect(ram.readByte(0x0000_000f)).toBe(0xab);
});

test("little-endian helpers read and write word and long values", () => {
  const ram = createRam(32);

  writeWord(ram, 0, 0x1234);
  writeLong(ram, 4, 0x89ab_cdef);

  expect(readWord(ram, 0)).toBe(0x1234);
  expect(readLong(ram, 4)).toBe(0x89ab_cdef);
});

test("address helpers compose program, data, and direct addresses", () => {
  expect(makeProgramAddress(0x12, 0x3456)).toBe(0x123456);
  expect(makeDataAddress(0xab, 0xcdef)).toBe(0xabcdef);
  expect(makeDirectAddress(0x1200, 0x34)).toBe(0x1234);
});

test("CPU can step a NOP through injected memory", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xea);
  const result = cpu.step();

  expect(result).toEqual({
    pcBefore: 0,
    opcode: 0xea,
    cycles: 2,
    stopped: false,
  });
  expect(cpu.readRegister("pc")).toBe(1);
  expect(cpu.readRegister("cycles")).toBe(2);
});

test("CPU exposes configured clock speed", () => {
  const cpu = createCpu({ memory: createRam(32), clockHz: 8_000_000 });

  expect(cpu.clock.hz).toBe(8_000_000);
  expect(cpu.clock.mhz).toBe(8);
  expect(cpu.clock.nanosecondsPerCycle).toBe(125);
});

test("CPU can execute STP and report stopped state", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xdb);
  const result = cpu.step();

  expect(result.stopped).toBe(true);
  expect(cpu.readRegister("stopped")).toBe(true);
});
