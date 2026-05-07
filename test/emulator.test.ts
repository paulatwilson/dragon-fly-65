import { expect, test } from "bun:test";
import {
  createClockConfig,
  createCpu,
  createInitialCpuState,
  createRam,
  getOpcodeDefinition,
  makeDataAddress,
  makeDirectAddress,
  makeProgramAddress,
  maskToWidth,
  OPCODES,
  readLong,
  readWord,
  RESET_VECTOR_ADDRESS,
  resolveWidthMode,
  StatusFlag,
  writeLong,
  writeWord,
} from "../src/emulator";

test("clock config defaults to the WDC 4 MHz minimum", () => {
  const clock = createClockConfig();

  expect(clock.hz).toBe(4_000_000);
  expect(clock.mhz).toBe(4);
  expect(clock.nanosecondsPerCycle).toBe(250);
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
    pcAfter: 1,
    opcode: 0xea,
    mnemonic: "NOP",
    bytes: [0xea],
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

test("CPU fetch helpers read through PRB:PC and advance PC", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("prb", 0x12);
  cpu.writeRegister("pc", 0xfffe);
  ram.writeByte(0x12fffe, 0x34);
  ram.writeByte(0x12ffff, 0x12);
  ram.writeByte(0x120000, 0x78);
  ram.writeByte(0x120001, 0x56);

  expect(cpu.fetchWord()).toBe(0x1234);
  expect(cpu.readRegister("pc")).toBe(0);
  expect(cpu.fetchWord()).toBe(0x5678);
  expect(cpu.readRegister("pc")).toBe(2);
});

test("CPU fetchLong reads little-endian values from program space", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("prb", 0x01);
  cpu.writeRegister("pc", 0x2000);
  ram.writeByte(0x012000, 0xef);
  ram.writeByte(0x012001, 0xcd);
  ram.writeByte(0x012002, 0xab);
  ram.writeByte(0x012003, 0x89);

  expect(cpu.fetchLong()).toBe(0x89ab_cdef);
  expect(cpu.readRegister("pc")).toBe(0x2004);
});

test("CPU immediate fetch helpers follow active accumulator and index widths", () => {
  const ram = createRam(64);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0x7f);
  expect(cpu.fetchAccumulatorImmediate()).toBe(0x7f);
  expect(cpu.readRegister("pc")).toBe(1);

  cpu.writeRegister("pc", 4);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0);
  ram.writeByte(4, 0x34);
  ram.writeByte(5, 0x12);
  expect(cpu.fetchAccumulatorImmediate()).toBe(0x1234);
  expect(cpu.readRegister("pc")).toBe(6);

  cpu.writeRegister("pc", 8);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  ram.writeByte(8, 0x78);
  ram.writeByte(9, 0x56);
  ram.writeByte(10, 0x34);
  ram.writeByte(11, 0x12);
  expect(cpu.fetchAccumulatorImmediate()).toBe(0x1234_5678);
  expect(cpu.readRegister("pc")).toBe(12);

  cpu.writeRegister("pc", 16);
  cpu.writeRegister("e16", true);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0);
  ram.writeByte(16, 0xcd);
  ram.writeByte(17, 0xab);
  expect(cpu.fetchIndexImmediate()).toBe(0xabcd);
  expect(cpu.readRegister("pc")).toBe(18);
});

test("opcode metadata describes implemented implied instructions", () => {
  expect(OPCODES.size).toBe(9);
  expect(getOpcodeDefinition(0xea)).toMatchObject({
    opcode: 0xea,
    mnemonic: "NOP",
    bytes: 1,
    cycles: 2,
    addressingMode: "implied",
  });
  expect(getOpcodeDefinition(0xdb)).toMatchObject({
    opcode: 0xdb,
    mnemonic: "STP",
    bytes: 1,
    cycles: 3,
    addressingMode: "implied",
  });
  expect(getOpcodeDefinition(0xff)).toBeUndefined();
});

test("flag instruction result includes trace metadata and register changes", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0x38);
  cpu.writeRegister("p", StatusFlag.Overflow);

  expect(cpu.step()).toMatchObject({
    opcode: 0x38,
    mnemonic: "SEC",
    bytes: [0x38],
    pcBefore: 0,
    pcAfter: 1,
    registerChanges: {
      p: {
        before: StatusFlag.Overflow,
        after: StatusFlag.Overflow | StatusFlag.Carry,
      },
    },
  });
});

test("CPU reset loads PC from the reset vector", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  writeWord(ram, RESET_VECTOR_ADDRESS, 0x8000);
  cpu.reset();

  expect(cpu.readRegister("pc")).toBe(0x8000);
  expect(cpu.readRegister("prb")).toBe(0);
});

test("CPU executes basic status flag instructions", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  const program = [
    0x38, // SEC
    0x18, // CLC
    0xf8, // SED
    0xd8, // CLD
    0x78, // SEI
    0x58, // CLI
    0x38, // SEC
    0xb8, // CLV
  ];

  for (const [address, opcode] of program.entries()) {
    ram.writeByte(address, opcode);
  }

  cpu.writeRegister("p", StatusFlag.Overflow);

  expect(cpu.step().opcode).toBe(0x38);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(
    StatusFlag.Carry,
  );

  expect(cpu.step().opcode).toBe(0x18);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0);

  expect(cpu.step().opcode).toBe(0xf8);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Decimal).toBe(
    StatusFlag.Decimal,
  );

  expect(cpu.step().opcode).toBe(0xd8);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Decimal).toBe(0);

  expect(cpu.step().opcode).toBe(0x78);
  expect(Number(cpu.readRegister("p")) & StatusFlag.InterruptDisable).toBe(
    StatusFlag.InterruptDisable,
  );

  expect(cpu.step().opcode).toBe(0x58);
  expect(Number(cpu.readRegister("p")) & StatusFlag.InterruptDisable).toBe(0);

  expect(cpu.step().opcode).toBe(0x38);
  expect(cpu.step().opcode).toBe(0xb8);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Overflow).toBe(0);
  expect(cpu.readRegister("pc")).toBe(program.length);
  expect(cpu.readRegister("cycles")).toBe(program.length * 2);
});

test("CPU can execute STP and report stopped state", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xdb);
  const result = cpu.step();

  expect(result).toMatchObject({
    opcode: 0xdb,
    mnemonic: "STP",
    bytes: [0xdb],
    cycles: 3,
    stopped: true,
    registerChanges: {
      stopped: {
        before: false,
        after: true,
      },
    },
  });
  expect(result.stopped).toBe(true);
  expect(cpu.readRegister("stopped")).toBe(true);
});
