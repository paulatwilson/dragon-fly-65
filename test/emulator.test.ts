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
  const ram = createRam(128);
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

  cpu.writeRegister("pc", 24);
  cpu.writeRegister("e16", true);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  ram.writeByte(24, 0x42);
  expect(cpu.fetchIndexImmediate()).toBe(0x42);
  expect(cpu.readRegister("pc")).toBe(25);

  cpu.writeRegister("pc", 32);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  ram.writeByte(32, 0xef);
  ram.writeByte(33, 0xbe);
  ram.writeByte(34, 0xad);
  ram.writeByte(35, 0xde);
  expect(cpu.fetchIndexImmediate()).toBe(0xdead_beef);
  expect(cpu.readRegister("pc")).toBe(36);
});

test("opcode metadata describes implemented implied instructions", () => {
  expect(OPCODES.size).toBe(32);
  expect(getOpcodeDefinition(0xa9)).toMatchObject({
    opcode: 0xa9,
    mnemonic: "LDA",
    cycles: 2,
    addressingMode: "immediate",
  });
  expect(getOpcodeDefinition(0xea)).toMatchObject({
    opcode: 0xea,
    mnemonic: "NOP",
    bytes: 1,
    cycles: 2,
    addressingMode: "implied",
  });
  expect(getOpcodeDefinition(0x85)).toMatchObject({
    opcode: 0x85,
    mnemonic: "STA",
    bytes: 2,
    cycles: 3,
    addressingMode: "direct",
  });
  expect(getOpcodeDefinition(0x8e)).toMatchObject({
    opcode: 0x8e,
    mnemonic: "STX",
    bytes: 3,
    cycles: 4,
    addressingMode: "absolute",
  });
  expect(getOpcodeDefinition(0xaa)).toMatchObject({
    opcode: 0xaa,
    mnemonic: "TAX",
    bytes: 1,
    cycles: 2,
    addressingMode: "implied",
  });
  expect(getOpcodeDefinition(0xe8)).toMatchObject({
    opcode: 0xe8,
    mnemonic: "INX",
    bytes: 1,
    cycles: 2,
    addressingMode: "implied",
  });
  expect(getOpcodeDefinition(0x48)).toMatchObject({
    opcode: 0x48,
    mnemonic: "PHA",
    bytes: 1,
    cycles: 3,
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

test("stack byte helpers use page one in W65C02 emulation", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("sp", 0x0100);
  cpu.pushByte(0xab);

  expect(ram.readByte(0x0100)).toBe(0xab);
  expect(cpu.readRegister("sp")).toBe(0x01ff);
  expect(cpu.pullByte()).toBe(0xab);
  expect(cpu.readRegister("sp")).toBe(0x0100);
});

test("stack byte helpers use 16-bit stack addresses outside W65C02 emulation", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("sp", 0x2000);
  cpu.pushByte(0xcd);

  expect(ram.readByte(0x2000)).toBe(0xcd);
  expect(cpu.readRegister("sp")).toBe(0x1fff);
  expect(cpu.pullByte()).toBe(0xcd);
  expect(cpu.readRegister("sp")).toBe(0x2000);
});

test("PHA and PLA round-trip accumulator values and update flags", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("a", 0x80);
  ram.writeByte(0, 0x48);
  ram.writeByte(1, 0xa9);
  ram.writeByte(2, 0x00);
  ram.writeByte(3, 0x68);

  expect(cpu.step()).toMatchObject({
    opcode: 0x48,
    mnemonic: "PHA",
    registerChanges: {
      sp: {
        before: 0x01ff,
        after: 0x01fe,
      },
    },
  });
  expect(ram.readByte(0x01ff)).toBe(0x80);

  expect(cpu.step().opcode).toBe(0xa9);
  expect(cpu.readRegister("a")).toBe(0);

  expect(cpu.step()).toMatchObject({
    opcode: 0x68,
    mnemonic: "PLA",
    registerChanges: {
      a: {
        before: 0,
        after: 0x80,
      },
      sp: {
        before: 0x01fe,
        after: 0x01ff,
      },
    },
  });
  expect(cpu.readRegister("a")).toBe(0x80);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );
});

test("PHA and PLA support 16-bit and 32-bit accumulator widths", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0);
  cpu.writeRegister("sp", 0x2001);
  cpu.writeRegister("a", 0xabcd);
  ram.writeByte(0, 0x48);
  ram.writeByte(1, 0xa9);
  ram.writeByte(2, 0x00);
  ram.writeByte(3, 0x00);
  ram.writeByte(4, 0x68);

  expect(cpu.step()).toMatchObject({
    opcode: 0x48,
    registerChanges: {
      sp: {
        before: 0x2001,
        after: 0x1fff,
      },
    },
  });
  expect(ram.readByte(0x2001)).toBe(0xab);
  expect(ram.readByte(0x2000)).toBe(0xcd);
  expect(cpu.step().opcode).toBe(0xa9);
  expect(cpu.step()).toMatchObject({
    opcode: 0x68,
    registerChanges: {
      a: {
        before: 0,
        after: 0xabcd,
      },
    },
  });

  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  cpu.writeRegister("sp", 0x3003);
  cpu.writeRegister("pc", 8);
  cpu.writeRegister("a", 0x89ab_cdef);
  ram.writeByte(8, 0x48);
  ram.writeByte(9, 0xa9);
  ram.writeByte(10, 0x00);
  ram.writeByte(11, 0x00);
  ram.writeByte(12, 0x00);
  ram.writeByte(13, 0x00);
  ram.writeByte(14, 0x68);

  expect(cpu.step()).toMatchObject({
    opcode: 0x48,
    registerChanges: {
      sp: {
        before: 0x3003,
        after: 0x2fff,
      },
    },
  });
  expect(ram.readByte(0x3003)).toBe(0x89);
  expect(ram.readByte(0x3002)).toBe(0xab);
  expect(ram.readByte(0x3001)).toBe(0xcd);
  expect(ram.readByte(0x3000)).toBe(0xef);
  expect(cpu.step().opcode).toBe(0xa9);
  expect(cpu.step()).toMatchObject({
    opcode: 0x68,
    registerChanges: {
      a: {
        before: 0,
        after: 0x89ab_cdef,
      },
    },
  });
});

test("PHP and PLP round-trip processor status", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Carry | StatusFlag.Negative);
  ram.writeByte(0, 0x08);
  ram.writeByte(1, 0x18);
  ram.writeByte(2, 0xb8);
  ram.writeByte(3, 0x28);

  expect(cpu.step()).toMatchObject({
    opcode: 0x08,
    mnemonic: "PHP",
    registerChanges: {
      sp: {
        before: 0x01ff,
        after: 0x01fe,
      },
    },
  });
  expect(ram.readByte(0x01ff)).toBe(StatusFlag.Carry | StatusFlag.Negative);

  expect(cpu.step().opcode).toBe(0x18);
  expect(cpu.step().opcode).toBe(0xb8);
  expect(cpu.step()).toMatchObject({
    opcode: 0x28,
    mnemonic: "PLP",
    registerChanges: {
      p: {
        before: StatusFlag.Negative,
        after: StatusFlag.Carry | StatusFlag.Negative,
      },
      sp: {
        before: 0x01fe,
        after: 0x01ff,
      },
    },
  });
  expect(cpu.readRegister("p")).toBe(StatusFlag.Carry | StatusFlag.Negative);
});

test("STA direct stores accumulator using direct register addressing", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("a", 0x1234_5678);
  cpu.writeRegister("dr", 0x0100);
  ram.writeByte(0, 0x85);
  ram.writeByte(1, 0x40);

  expect(cpu.step()).toMatchObject({
    opcode: 0x85,
    mnemonic: "STA",
    bytes: [0x85, 0x40],
    pcAfter: 2,
    cycles: 3,
    effectiveAddress: 0x0140,
  });
  expect(ram.readByte(0x0140)).toBe(0x78);
  expect(cpu.readRegister("cycles")).toBe(3);
});

test("STA absolute stores accumulator through the data bank", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  cpu.writeRegister("a", 0x89ab_cdef);
  cpu.writeRegister("drb", 0x02);
  ram.writeByte(0, 0x8d);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x20);

  expect(cpu.step()).toMatchObject({
    opcode: 0x8d,
    mnemonic: "STA",
    bytes: [0x8d, 0x00, 0x20],
    pcAfter: 3,
    cycles: 4,
    effectiveAddress: 0x022000,
  });
  expect(readLong(ram, 0x022000)).toBe(0x89ab_cdef);
});

test("STX and STY direct store index registers at active index width", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("x", 0xabcd);
  cpu.writeRegister("y", 0x4567);
  cpu.writeRegister("e16", true);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0);
  cpu.writeRegister("dr", 0x0300);
  ram.writeByte(0, 0x86);
  ram.writeByte(1, 0x10);
  ram.writeByte(2, 0x84);
  ram.writeByte(3, 0x20);

  expect(cpu.step()).toMatchObject({
    opcode: 0x86,
    effectiveAddress: 0x0310,
  });
  expect(readWord(ram, 0x0310)).toBe(0xabcd);

  expect(cpu.step()).toMatchObject({
    opcode: 0x84,
    effectiveAddress: 0x0320,
  });
  expect(readWord(ram, 0x0320)).toBe(0x4567);
  expect(cpu.readRegister("cycles")).toBe(6);
});

test("STX and STY absolute store index registers through the data bank", () => {
  const ram = createRam();
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("x", 0xdead_beef);
  cpu.writeRegister("y", 0x80);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  cpu.writeRegister("drb", 0x03);
  ram.writeByte(0, 0x8e);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x40);
  ram.writeByte(3, 0x8c);
  ram.writeByte(4, 0x10);
  ram.writeByte(5, 0x40);

  expect(cpu.step()).toMatchObject({
    opcode: 0x8e,
    bytes: [0x8e, 0x00, 0x40],
    effectiveAddress: 0x034000,
  });
  expect(readLong(ram, 0x034000)).toBe(0xdead_beef);

  cpu.writeRegister("e16", true);
  cpu.writeRegister("e8", true);
  expect(cpu.step()).toMatchObject({
    opcode: 0x8c,
    bytes: [0x8c, 0x10, 0x40],
    effectiveAddress: 0x034010,
  });
  expect(ram.readByte(0x034010)).toBe(0x80);
});

test("TAX and TAY transfer accumulator into index registers with flags", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  cpu.writeRegister("a", 0x8000_0000);
  ram.writeByte(0, 0xaa);
  ram.writeByte(1, 0xa8);

  expect(cpu.step()).toMatchObject({
    opcode: 0xaa,
    mnemonic: "TAX",
    registerChanges: {
      x: {
        before: 0,
        after: 0x8000_0000,
      },
    },
  });
  expect(cpu.readRegister("x")).toBe(0x8000_0000);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );

  cpu.writeRegister("a", 0);
  expect(cpu.step()).toMatchObject({
    opcode: 0xa8,
    mnemonic: "TAY",
    registerChanges: {
      p: {
        before: StatusFlag.Negative,
        after: StatusFlag.Zero,
      },
    },
  });
  expect(cpu.readRegister("y")).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);
});

test("TXA and TYA transfer index registers into accumulator width", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0);
  cpu.writeRegister("x", 0x1234_8000);
  cpu.writeRegister("y", 0);
  ram.writeByte(0, 0x8a);
  ram.writeByte(1, 0x98);

  expect(cpu.step()).toMatchObject({
    opcode: 0x8a,
    mnemonic: "TXA",
    registerChanges: {
      a: {
        before: 0,
        after: 0x8000,
      },
    },
  });
  expect(cpu.readRegister("a")).toBe(0x8000);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );

  expect(cpu.step()).toMatchObject({
    opcode: 0x98,
    mnemonic: "TYA",
    registerChanges: {
      a: {
        before: 0x8000,
        after: 0,
      },
      p: {
        before: StatusFlag.Negative,
        after: StatusFlag.Zero,
      },
    },
  });
  expect(cpu.readRegister("a")).toBe(0);
});

test("TXS transfers X to stack without flags and TSX updates flags", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("x", 0x1234);
  cpu.writeRegister("p", StatusFlag.Negative);
  ram.writeByte(0, 0x9a);
  ram.writeByte(1, 0xba);

  expect(cpu.step()).toMatchObject({
    opcode: 0x9a,
    mnemonic: "TXS",
    registerChanges: {
      sp: {
        before: 0x01ff,
        after: 0x1234,
      },
    },
  });
  expect(cpu.readRegister("sp")).toBe(0x1234);
  expect(cpu.readRegister("p")).toBe(StatusFlag.Negative);

  cpu.writeRegister("e16", true);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0);
  cpu.writeRegister("sp", 0x8000);
  expect(cpu.step()).toMatchObject({
    opcode: 0xba,
    mnemonic: "TSX",
    registerChanges: {
      x: {
        before: 0x1234,
        after: 0x8000,
      },
      p: {
        before: 0,
        after: StatusFlag.Negative,
      },
    },
  });
  expect(cpu.readRegister("x")).toBe(0x8000);
});

test("INX DEX INY and DEY wrap at active index width and update flags", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("x", 0xff);
  cpu.writeRegister("y", 0);
  cpu.writeRegister("p", 0);
  ram.writeByte(0, 0xe8);
  ram.writeByte(1, 0xca);
  ram.writeByte(2, 0xc8);
  ram.writeByte(3, 0x88);

  expect(cpu.step()).toMatchObject({
    opcode: 0xe8,
    mnemonic: "INX",
  });
  expect(cpu.readRegister("x")).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);

  expect(cpu.step()).toMatchObject({
    opcode: 0xca,
    mnemonic: "DEX",
  });
  expect(cpu.readRegister("x")).toBe(0xff);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );

  expect(cpu.step()).toMatchObject({
    opcode: 0xc8,
    mnemonic: "INY",
  });
  expect(cpu.readRegister("y")).toBe(1);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(0);

  expect(cpu.step()).toMatchObject({
    opcode: 0x88,
    mnemonic: "DEY",
  });
  expect(cpu.readRegister("y")).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);
  expect(cpu.readRegister("cycles")).toBe(8);
});

test("LDA immediate loads accumulator and updates N/Z in 8-bit mode", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xa9);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0xa9);
  ram.writeByte(3, 0x80);

  const zeroResult = cpu.step();
  expect(zeroResult).toMatchObject({
    opcode: 0xa9,
    mnemonic: "LDA",
    bytes: [0xa9, 0x00],
    pcAfter: 2,
    registerChanges: {
      p: {
        before: StatusFlag.Memory | StatusFlag.Index | StatusFlag.InterruptDisable,
        after:
          StatusFlag.Memory |
          StatusFlag.Index |
          StatusFlag.InterruptDisable |
          StatusFlag.Zero,
      },
    },
  });
  expect(cpu.readRegister("a")).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);

  const negativeResult = cpu.step();
  expect(negativeResult).toMatchObject({
    opcode: 0xa9,
    bytes: [0xa9, 0x80],
    pcAfter: 4,
    registerChanges: {
      a: {
        before: 0,
        after: 0x80,
      },
    },
  });
  expect(cpu.readRegister("a")).toBe(0x80);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );
});

test("LDA immediate supports 16-bit and 32-bit accumulator widths", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0);
  ram.writeByte(0, 0xa9);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x80);

  expect(cpu.step()).toMatchObject({
    opcode: 0xa9,
    bytes: [0xa9, 0x00, 0x80],
    pcAfter: 3,
  });
  expect(cpu.readRegister("a")).toBe(0x8000);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );

  cpu.writeRegister("pc", 8);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  ram.writeByte(8, 0xa9);
  ram.writeByte(9, 0x00);
  ram.writeByte(10, 0x00);
  ram.writeByte(11, 0x00);
  ram.writeByte(12, 0x80);

  expect(cpu.step()).toMatchObject({
    opcode: 0xa9,
    bytes: [0xa9, 0x00, 0x00, 0x00, 0x80],
    pcAfter: 13,
  });
  expect(cpu.readRegister("a")).toBe(0x8000_0000);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );
});

test("LDX and LDY immediate follow index width and update flags", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xa2);
  ram.writeByte(1, 0x7f);
  ram.writeByte(2, 0xa0);
  ram.writeByte(3, 0x00);

  expect(cpu.step()).toMatchObject({
    opcode: 0xa2,
    mnemonic: "LDX",
    bytes: [0xa2, 0x7f],
    pcAfter: 2,
  });
  expect(cpu.readRegister("x")).toBe(0x7f);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);

  expect(cpu.step()).toMatchObject({
    opcode: 0xa0,
    mnemonic: "LDY",
    bytes: [0xa0, 0x00],
    pcAfter: 4,
  });
  expect(cpu.readRegister("y")).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);

  cpu.writeRegister("pc", 8);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("e8", true);
  cpu.writeRegister("p", 0);
  ram.writeByte(8, 0xa2);
  ram.writeByte(9, 0x00);
  ram.writeByte(10, 0x00);
  ram.writeByte(11, 0x00);
  ram.writeByte(12, 0x80);

  expect(cpu.step()).toMatchObject({
    opcode: 0xa2,
    bytes: [0xa2, 0x00, 0x00, 0x00, 0x80],
    pcAfter: 13,
  });
  expect(cpu.readRegister("x")).toBe(0x8000_0000);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );

  cpu.writeRegister("pc", 16);
  cpu.writeRegister("e16", true);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0);
  ram.writeByte(16, 0xa0);
  ram.writeByte(17, 0x00);
  ram.writeByte(18, 0x80);

  expect(cpu.step()).toMatchObject({
    opcode: 0xa0,
    bytes: [0xa0, 0x00, 0x80],
    pcAfter: 19,
  });
  expect(cpu.readRegister("y")).toBe(0x8000);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(
    StatusFlag.Negative,
  );
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
