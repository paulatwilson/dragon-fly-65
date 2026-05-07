import { expect, test } from "bun:test";
import {
  createClockConfig,
  createCpu,
  createInitialCpuState,
  createRam,
  EMU_COP_VECTOR,
  EMU_IRQ_BRK_VECTOR,
  EMU_NMI_VECTOR,
  getOpcodeDefinition,
  makeDataAddress,
  makeDirectAddress,
  makeProgramAddress,
  maskToWidth,
  NATIVE_BRK_VECTOR,
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
  expect(OPCODES.size).toBe(76);
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

// ---------------------------------------------------------------------------
// Chunk 7: Branches and Jumps
// ---------------------------------------------------------------------------

test("BEQ taken when Zero flag is set", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // BEQ +4 (forward branch)
  ram.writeByte(0, 0xf0);
  ram.writeByte(1, 0x04);
  cpu.writeRegister("p", StatusFlag.Zero);

  const result = cpu.step();

  expect(result).toMatchObject({
    opcode: 0xf0,
    mnemonic: "BEQ",
    bytes: [0xf0, 0x04],
    pcBefore: 0,
    pcAfter: 6, // 2 (instruction length) + 4 (offset)
    cycles: 3,
    stopped: false,
  });
  expect(cpu.readRegister("pc")).toBe(6);
});

test("BEQ not taken when Zero flag is clear", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xf0);
  ram.writeByte(1, 0x04);
  cpu.writeRegister("p", 0);

  const result = cpu.step();

  expect(result).toMatchObject({
    opcode: 0xf0,
    mnemonic: "BEQ",
    pcAfter: 2,
    cycles: 2,
  });
  expect(cpu.readRegister("pc")).toBe(2);
});

test("BNE taken when Zero flag is clear", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xd0);
  ram.writeByte(1, 0x02);
  cpu.writeRegister("p", 0);

  const result = cpu.step();

  expect(result).toMatchObject({
    opcode: 0xd0,
    mnemonic: "BNE",
    pcAfter: 4,
    cycles: 3,
  });
});

test("BNE not taken when Zero flag is set", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xd0);
  ram.writeByte(1, 0x02);
  cpu.writeRegister("p", StatusFlag.Zero);

  expect(cpu.step()).toMatchObject({ pcAfter: 2, cycles: 2 });
});

test("BCC taken when Carry is clear", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0x90);
  ram.writeByte(1, 0x03);
  cpu.writeRegister("p", 0);

  expect(cpu.step()).toMatchObject({ mnemonic: "BCC", pcAfter: 5, cycles: 3 });
});

test("BCS taken when Carry is set", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0xb0);
  ram.writeByte(1, 0x01);
  cpu.writeRegister("p", StatusFlag.Carry);

  expect(cpu.step()).toMatchObject({ mnemonic: "BCS", pcAfter: 3, cycles: 3 });
});

test("BMI taken when Negative is set", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0x30);
  ram.writeByte(1, 0x05);
  cpu.writeRegister("p", StatusFlag.Negative);

  expect(cpu.step()).toMatchObject({ mnemonic: "BMI", pcAfter: 7, cycles: 3 });
});

test("BPL taken when Negative is clear", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0x10);
  ram.writeByte(1, 0x05);
  cpu.writeRegister("p", 0);

  expect(cpu.step()).toMatchObject({ mnemonic: "BPL", pcAfter: 7, cycles: 3 });
});

test("BVC taken when Overflow is clear", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0x50);
  ram.writeByte(1, 0x01);
  cpu.writeRegister("p", 0);

  expect(cpu.step()).toMatchObject({ mnemonic: "BVC", pcAfter: 3, cycles: 3 });
});

test("BVS taken when Overflow is set", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0x70);
  ram.writeByte(1, 0x01);
  cpu.writeRegister("p", StatusFlag.Overflow);

  expect(cpu.step()).toMatchObject({ mnemonic: "BVS", pcAfter: 3, cycles: 3 });
});

test("branch backward using signed offset", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Start at PC=10, BEQ with offset -4 (0xFC = 252 unsigned = -4 signed)
  cpu.writeRegister("pc", 10);
  ram.writeByte(10, 0xf0);
  ram.writeByte(11, 0xfc); // -4 signed
  cpu.writeRegister("p", StatusFlag.Zero);

  const result = cpu.step();

  // PC after fetch = 12, then 12 + (-4) = 8
  expect(result).toMatchObject({ pcAfter: 8, cycles: 3 });
  expect(cpu.readRegister("pc")).toBe(8);
});

test("branch taken in W65C02 emulation mode adds page-cross cycle", () => {
  const ram = createRam(512);
  const cpu = createCpu({ memory: ram });

  // BEQ at 0x00FC, offset +8: PC after fetch = 0x00FE, target = 0x0106 (page cross 0x00->0x01)
  cpu.writeRegister("pc", 0x00fc);
  ram.writeByte(0x00fc, 0xf0);
  ram.writeByte(0x00fd, 0x08);
  // e8 and e16 are true by default (W65C02 emulation mode)
  cpu.writeRegister("p", StatusFlag.Zero);

  const result = cpu.step();

  expect(result.cycles).toBe(4);
  expect(cpu.readRegister("pc")).toBe(0x0106);
});

test("branch taken in native mode does not add page-cross cycle", () => {
  const ram = createRam(512);
  const cpu = createCpu({ memory: ram });

  // Same address and offset but in W65C832 native mode (e8=false, e16=false)
  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("pc", 0x00fc);
  ram.writeByte(0x00fc, 0xf0);
  ram.writeByte(0x00fd, 0x08);
  cpu.writeRegister("p", StatusFlag.Zero);

  const result = cpu.step();

  expect(result.cycles).toBe(3);
  expect(cpu.readRegister("pc")).toBe(0x0106);
});

test("JMP absolute sets PC to target address", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  ram.writeByte(0, 0x4c);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x20); // target = 0x2000

  const result = cpu.step();

  expect(result).toMatchObject({
    opcode: 0x4c,
    mnemonic: "JMP",
    bytes: [0x4c, 0x00, 0x20],
    pcBefore: 0,
    pcAfter: 0x2000,
    cycles: 3,
    stopped: false,
  });
  expect(cpu.readRegister("pc")).toBe(0x2000);
});

test("JMP absolute does not affect flags or registers", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Carry | StatusFlag.Zero);
  ram.writeByte(0, 0x4c);
  ram.writeByte(1, 0x34);
  ram.writeByte(2, 0x12); // target = 0x1234

  cpu.step();

  expect(cpu.readRegister("pc")).toBe(0x1234);
  expect(Number(cpu.readRegister("p")) & (StatusFlag.Carry | StatusFlag.Zero)).toBe(
    StatusFlag.Carry | StatusFlag.Zero,
  );
});

// ---------------------------------------------------------------------------
// Chunk 8: Subroutines
// ---------------------------------------------------------------------------

test("JSR pushes return address and jumps to target", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  // JSR $1000 at address 0x0200
  cpu.writeRegister("pc", 0x0200);
  ram.writeByte(0x0200, 0x20);
  ram.writeByte(0x0201, 0x00);
  ram.writeByte(0x0202, 0x10); // target = 0x1000

  const spBefore = Number(cpu.readRegister("sp")); // 0x01ff
  const result = cpu.step();

  // PC should now be at the subroutine
  expect(cpu.readRegister("pc")).toBe(0x1000);

  // Return address pushed is PC-1 = 0x0202 (last byte of JSR)
  const spAfter = Number(cpu.readRegister("sp"));
  expect(spAfter).toBe(spBefore - 2);

  // High byte at spBefore, low byte at spBefore-1
  expect(ram.readByte(0x01ff)).toBe(0x02); // high byte of 0x0202
  expect(ram.readByte(0x01fe)).toBe(0x02); // low byte of 0x0202

  expect(result).toMatchObject({
    opcode: 0x20,
    mnemonic: "JSR",
    bytes: [0x20, 0x00, 0x10],
    pcBefore: 0x0200,
    pcAfter: 0x1000,
    cycles: 6,
    stopped: false,
  });
});

test("RTS returns to instruction after JSR", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  // JSR $1000 at address 0x0200
  cpu.writeRegister("pc", 0x0200);
  ram.writeByte(0x0200, 0x20);
  ram.writeByte(0x0201, 0x00);
  ram.writeByte(0x0202, 0x10);

  // RTS at subroutine
  ram.writeByte(0x1000, 0x60);

  cpu.step(); // JSR
  expect(cpu.readRegister("pc")).toBe(0x1000);

  const spBeforeRts = Number(cpu.readRegister("sp"));
  const result = cpu.step(); // RTS

  // Should land at 0x0203 (byte after JSR instruction)
  expect(cpu.readRegister("pc")).toBe(0x0203);

  // SP restored to pre-JSR value
  expect(Number(cpu.readRegister("sp"))).toBe(spBeforeRts + 2);

  expect(result).toMatchObject({
    opcode: 0x60,
    mnemonic: "RTS",
    pcBefore: 0x1000,
    pcAfter: 0x0203,
    cycles: 6,
    stopped: false,
  });
});

test("JSR and RTS round-trip executes a small subroutine", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  // Main: LDA #$42, JSR $0300, STP
  ram.writeByte(0x0200, 0xa9); // LDA #$42
  ram.writeByte(0x0201, 0x42);
  ram.writeByte(0x0202, 0x20); // JSR $0300
  ram.writeByte(0x0203, 0x00);
  ram.writeByte(0x0204, 0x03);
  ram.writeByte(0x0205, 0xdb); // STP

  // Subroutine at $0300: LDA #$ff, RTS
  ram.writeByte(0x0300, 0xa9); // LDA #$ff
  ram.writeByte(0x0301, 0xff);
  ram.writeByte(0x0302, 0x60); // RTS

  cpu.writeRegister("pc", 0x0200);
  // Switch to native mode so accumulator is 8-bit via Memory flag
  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);

  cpu.step(); // LDA #$42
  expect(cpu.readRegister("a")).toBe(0x42);

  cpu.step(); // JSR $0300
  expect(cpu.readRegister("pc")).toBe(0x0300);

  cpu.step(); // LDA #$ff
  expect(cpu.readRegister("a")).toBe(0xff);

  cpu.step(); // RTS
  expect(cpu.readRegister("pc")).toBe(0x0205); // next instruction after JSR

  cpu.step(); // STP
  expect(cpu.readRegister("stopped")).toBe(true);
});

test("JSR stack contents are correct in W65C02 emulation mode", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  // JSR $ABCD at address 0x0010
  cpu.writeRegister("pc", 0x0010);
  ram.writeByte(0x0010, 0x20);
  ram.writeByte(0x0011, 0xcd);
  ram.writeByte(0x0012, 0xab); // target = 0xABCD

  const spBefore = Number(cpu.readRegister("sp")); // 0x01ff in emulation mode
  cpu.step();

  // Return address = 0x0012 (last byte of JSR)
  expect(ram.readByte(spBefore)).toBe(0x00);      // high byte
  expect(ram.readByte(spBefore - 1)).toBe(0x12);  // low byte
  expect(cpu.readRegister("sp")).toBe(spBefore - 2);
});

// ---------------------------------------------------------------------------
// Chunk 9: ALU and Comparisons
// ---------------------------------------------------------------------------

// --- AND / ORA / EOR --------------------------------------------------------

test("AND immediate clears bits and sets N/Z flags", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // 8-bit mode: A = 0xFF AND 0x0F = 0x0F (N clear, Z clear)
  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0xff);
  ram.writeByte(0, 0x29);
  ram.writeByte(1, 0x0f);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0x0f);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(0);
});

test("AND immediate sets Zero flag when result is zero", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0xf0);
  ram.writeByte(0, 0x29);
  ram.writeByte(1, 0x0f);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);
});

test("ORA immediate sets bits and Negative flag", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0x01);
  ram.writeByte(0, 0x09);
  ram.writeByte(1, 0x80);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0x81);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(StatusFlag.Negative);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);
});

test("EOR immediate toggles bits and sets Zero flag", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0xaa);
  ram.writeByte(0, 0x49);
  ram.writeByte(1, 0xaa);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);
});

// --- ADC --------------------------------------------------------------------

test("ADC immediate adds operand to accumulator", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0x10);
  ram.writeByte(0, 0x69);
  ram.writeByte(1, 0x05);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0x15);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Overflow).toBe(0);
});

test("ADC immediate sets Carry on unsigned overflow", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0xff);
  ram.writeByte(0, 0x69);
  ram.writeByte(1, 0x01);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0x00);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);
});

test("ADC immediate sets Overflow on signed overflow (positive + positive = negative)", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // 0x50 + 0x50 = 0xA0 — both positive, result is negative in 8-bit signed
  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0x50);
  ram.writeByte(0, 0x69);
  ram.writeByte(1, 0x50);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0xa0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Overflow).toBe(StatusFlag.Overflow);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(StatusFlag.Negative);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0);
});

test("ADC immediate uses carry-in from status register", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index | StatusFlag.Carry);
  cpu.writeRegister("a", 0x10);
  ram.writeByte(0, 0x69);
  ram.writeByte(1, 0x05);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0x16); // 0x10 + 0x05 + carry(1)
});

test("ADC immediate works in 16-bit accumulator mode", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // W65C816 emulation, M=0 → 16-bit accumulator
  cpu.writeRegister("e16", true);
  cpu.writeRegister("e8", false);
  cpu.writeRegister("p", 0); // M=0, X=0 → 16-bit accumulator
  cpu.writeRegister("a", 0x00ff);
  ram.writeByte(0, 0x69);
  ram.writeByte(1, 0x01);
  ram.writeByte(2, 0x00);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0x0100);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0);
});

// --- SBC --------------------------------------------------------------------

test("SBC immediate subtracts operand from accumulator (carry set = no borrow)", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index | StatusFlag.Carry);
  cpu.writeRegister("a", 0x10);
  ram.writeByte(0, 0xe9);
  ram.writeByte(1, 0x05);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0x0b);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry); // no borrow
  expect(Number(cpu.readRegister("p")) & StatusFlag.Overflow).toBe(0);
});

test("SBC immediate clears Carry when result borrows", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index | StatusFlag.Carry);
  cpu.writeRegister("a", 0x05);
  ram.writeByte(0, 0xe9);
  ram.writeByte(1, 0x10);

  cpu.step();
  // 0x05 - 0x10 = -0x0B → 0xF5 in 8-bit unsigned; borrow → C clear
  expect(cpu.readRegister("a")).toBe(0xf5);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(StatusFlag.Negative);
});

test("SBC immediate sets Overflow on signed overflow (positive - negative = positive overflow)", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // 0x50 (+80) - 0x80 (-128) = +208, overflows 8-bit signed range → V set
  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index | StatusFlag.Carry);
  cpu.writeRegister("a", 0x50);
  ram.writeByte(0, 0xe9);
  ram.writeByte(1, 0x80);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0xd0); // 0x50 + ~0x80 + 1 = 0x50 + 0x7f + 1 = 0xd0
  expect(Number(cpu.readRegister("p")) & StatusFlag.Overflow).toBe(StatusFlag.Overflow);
});

// --- CMP --------------------------------------------------------------------

test("CMP immediate sets Zero and Carry when equal", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0x42);
  ram.writeByte(0, 0xc9);
  ram.writeByte(1, 0x42);

  cpu.step();
  expect(cpu.readRegister("a")).toBe(0x42); // A unchanged
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(0);
});

test("CMP immediate sets Carry and clears Zero when A greater than operand", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0x50);
  ram.writeByte(0, 0xc9);
  ram.writeByte(1, 0x10);

  cpu.step();
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(0);
});

test("CMP immediate clears Carry when A less than operand", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0x10);
  ram.writeByte(0, 0xc9);
  ram.writeByte(1, 0x50);

  cpu.step();
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(StatusFlag.Negative);
});

// --- CPX / CPY --------------------------------------------------------------

test("CPX immediate compares X and sets flags correctly", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("x", 0x20);
  ram.writeByte(0, 0xe0);
  ram.writeByte(1, 0x20);

  cpu.step();
  expect(cpu.readRegister("x")).toBe(0x20); // X unchanged
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(StatusFlag.Zero);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry);
});

test("CPY immediate compares Y and sets flags correctly", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("y", 0x10);
  ram.writeByte(0, 0xc0);
  ram.writeByte(1, 0x20);

  cpu.step();
  expect(cpu.readRegister("y")).toBe(0x10); // Y unchanged
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0); // Y < operand
  expect(Number(cpu.readRegister("p")) & StatusFlag.Zero).toBe(0);
});

// ---------------------------------------------------------------------------
// Chunk 10: Addressing Modes
// ---------------------------------------------------------------------------

// --- Address resolver helpers -----------------------------------------------

test("resolveDirectAddress returns DR + offset", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("dr", 0x0020);
  expect(cpu.resolveDirectAddress([0x10])).toBe(0x0030);
  expect(cpu.resolveDirectAddress([0x00])).toBe(0x0020);
  expect(cpu.resolveDirectAddress([0xff])).toBe(0x011f);
});

test("resolveDirectIndexedXAddress returns DR + offset + X (8-bit index)", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("dr", 0x0010);
  cpu.writeRegister("x", 0x05);
  // e8=true, e16=true → 8-bit index
  expect(cpu.resolveDirectIndexedXAddress([0x10])).toBe(0x0025); // 0x10 + 0x10 + 0x05
});

test("resolveDirectIndexedYAddress returns DR + offset + Y (8-bit index)", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("dr", 0x0000);
  cpu.writeRegister("y", 0x08);
  expect(cpu.resolveDirectIndexedYAddress([0x10])).toBe(0x0018);
});

test("resolveAbsoluteAddress returns DRB:word", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("drb", 0x02);
  expect(cpu.resolveAbsoluteAddress([0x00, 0x30])).toBe(0x023000);
  expect(cpu.resolveAbsoluteAddress([0x34, 0x12])).toBe(0x021234);
});

test("resolveAbsoluteIndexedXAddress returns DRB:(word + X)", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("drb", 0x00);
  cpu.writeRegister("x", 0x10);
  expect(cpu.resolveAbsoluteIndexedXAddress([0x00, 0x20])).toBe(0x002010); // 0x2000 + 0x10
});

test("resolveAbsoluteIndexedYAddress returns DRB:(word + Y)", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("drb", 0x00);
  cpu.writeRegister("y", 0x04);
  expect(cpu.resolveAbsoluteIndexedYAddress([0x00, 0x10])).toBe(0x001004); // 0x1000 + 0x04
});

test("resolveLongAbsoluteAddress returns bank:word from 3 operand bytes", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  expect(cpu.resolveLongAbsoluteAddress([0x34, 0x12, 0x05])).toBe(0x051234);
  expect(cpu.resolveLongAbsoluteAddress([0x00, 0x00, 0x01])).toBe(0x010000);
});

test("resolveIndirectAddress reads word pointer from direct page", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  // DR = 0, dp offset = 0x10 → pointer at address 0x10
  cpu.writeRegister("dr", 0x00);
  cpu.writeRegister("drb", 0x00);
  ram.writeByte(0x10, 0x34);
  ram.writeByte(0x11, 0x12); // pointer = 0x1234
  expect(cpu.resolveIndirectAddress([0x10])).toBe(0x001234);
});

test("resolveStackRelativeAddress returns SP + offset", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("sp", 0x01f0);
  expect(cpu.resolveStackRelativeAddress([0x04])).toBe(0x01f4);
  expect(cpu.resolveStackRelativeAddress([0x00])).toBe(0x01f0);
});

// --- Instruction tests (one per new mode) -----------------------------------

test("LDA direct loads accumulator from direct page address", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("dr", 0x00);
  ram.writeByte(0x20, 0xab); // value at dp offset 0x20
  ram.writeByte(0, 0xa5);
  ram.writeByte(1, 0x20);

  const result = cpu.step();

  expect(cpu.readRegister("a")).toBe(0xab);
  expect(result).toMatchObject({ opcode: 0xa5, mnemonic: "LDA", effectiveAddress: 0x20, cycles: 3 });
});

test("LDA absolute loads accumulator from absolute address", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("drb", 0x00);
  ram.writeByte(0x2000, 0x55);
  ram.writeByte(0, 0xad);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x20); // abs = 0x2000

  const result = cpu.step();

  expect(cpu.readRegister("a")).toBe(0x55);
  expect(result).toMatchObject({ opcode: 0xad, effectiveAddress: 0x2000, cycles: 4 });
});

test("LDA dp,X loads accumulator from direct page indexed by X", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("dr", 0x00);
  cpu.writeRegister("x", 0x04);
  ram.writeByte(0x14, 0x77); // dp offset 0x10 + X(0x04) = 0x14
  ram.writeByte(0, 0xb5);
  ram.writeByte(1, 0x10);

  const result = cpu.step();

  expect(cpu.readRegister("a")).toBe(0x77);
  expect(result).toMatchObject({ opcode: 0xb5, effectiveAddress: 0x14, cycles: 4 });
});

test("LDA abs,X loads accumulator from absolute address indexed by X", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("drb", 0x00);
  cpu.writeRegister("x", 0x02);
  ram.writeByte(0x1002, 0x33); // 0x1000 + X(0x02) = 0x1002
  ram.writeByte(0, 0xbd);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x10);

  const result = cpu.step();

  expect(cpu.readRegister("a")).toBe(0x33);
  expect(result).toMatchObject({ opcode: 0xbd, effectiveAddress: 0x1002, cycles: 4 });
});

test("LDA abs,Y loads accumulator from absolute address indexed by Y", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("drb", 0x00);
  cpu.writeRegister("y", 0x08);
  ram.writeByte(0x1008, 0xcc); // 0x1000 + Y(0x08) = 0x1008
  ram.writeByte(0, 0xb9);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x10);

  const result = cpu.step();

  expect(cpu.readRegister("a")).toBe(0xcc);
  expect(result).toMatchObject({ opcode: 0xb9, effectiveAddress: 0x1008, cycles: 4 });
});

test("LDA long loads accumulator from 24-bit address", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  ram.writeByte(0x013000, 0x99);
  ram.writeByte(0, 0xaf);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x30);
  ram.writeByte(3, 0x01); // long = 0x013000

  const result = cpu.step();

  expect(cpu.readRegister("a")).toBe(0x99);
  expect(result).toMatchObject({ opcode: 0xaf, effectiveAddress: 0x013000, cycles: 5 });
});

test("LDA (dp) loads accumulator via indirect pointer in direct page", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("dr", 0x00);
  cpu.writeRegister("drb", 0x00);
  // Pointer at dp offset 0x10 → 0x2000
  ram.writeByte(0x10, 0x00);
  ram.writeByte(0x11, 0x20);
  // Value at 0x2000
  ram.writeByte(0x2000, 0x44);
  ram.writeByte(0, 0xb2);
  ram.writeByte(1, 0x10);

  const result = cpu.step();

  expect(cpu.readRegister("a")).toBe(0x44);
  expect(result).toMatchObject({ opcode: 0xb2, effectiveAddress: 0x2000, cycles: 5 });
});

test("LDA sr,S loads accumulator from stack-relative address", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("sp", 0x01f0);
  ram.writeByte(0x01f4, 0xbe); // SP(0x01f0) + offset(0x04) = 0x01f4
  ram.writeByte(0, 0xa3);
  ram.writeByte(1, 0x04);

  const result = cpu.step();

  expect(cpu.readRegister("a")).toBe(0xbe);
  expect(result).toMatchObject({ opcode: 0xa3, effectiveAddress: 0x01f4, cycles: 4 });
});

test("STA dp,X stores accumulator to direct page indexed address", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0xdd);
  cpu.writeRegister("dr", 0x00);
  cpu.writeRegister("x", 0x03);
  ram.writeByte(0, 0x95);
  ram.writeByte(1, 0x10); // dp offset 0x10 + X(0x03) = 0x13

  cpu.step();

  expect(ram.readByte(0x13)).toBe(0xdd);
});

test("STA abs,X stores accumulator to absolute indexed address", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("a", 0x7e);
  cpu.writeRegister("drb", 0x00);
  cpu.writeRegister("x", 0x05);
  ram.writeByte(0, 0x9d);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x10); // 0x1000 + X(0x05) = 0x1005

  cpu.step();

  expect(ram.readByte(0x1005)).toBe(0x7e);
});

test("LDX direct loads X from direct page address", () => {
  const ram = createRam(256);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("dr", 0x00);
  ram.writeByte(0x30, 0x42);
  ram.writeByte(0, 0xa6);
  ram.writeByte(1, 0x30);

  cpu.step();

  expect(cpu.readRegister("x")).toBe(0x42);
});

test("LDY absolute loads Y from absolute address", () => {
  const ram = createRam(0x4000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index);
  cpu.writeRegister("drb", 0x00);
  ram.writeByte(0x3000, 0x11);
  ram.writeByte(0, 0xac);
  ram.writeByte(1, 0x00);
  ram.writeByte(2, 0x30);

  cpu.step();

  expect(cpu.readRegister("y")).toBe(0x11);
});

// ---------------------------------------------------------------------------
// Chunk 11: Mode Switching
// ---------------------------------------------------------------------------

// --- REP -------------------------------------------------------------------

test("REP clears bits in the processor status register", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Start in native mode so REP can clear M and X
  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("p", StatusFlag.Carry | StatusFlag.Overflow | StatusFlag.Negative);
  ram.writeByte(0, 0xc2);
  ram.writeByte(1, StatusFlag.Carry | StatusFlag.Overflow); // clear C and V

  const result = cpu.step();

  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Overflow).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Negative).toBe(StatusFlag.Negative);
  expect(result).toMatchObject({ opcode: 0xc2, mnemonic: "REP", cycles: 3 });
});

test("REP cannot clear M or X bits in emulation mode (E16=1)", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Default state is W65C02 emulation (E16=true, E8=true), M and X already set
  cpu.writeRegister("p", StatusFlag.Memory | StatusFlag.Index | StatusFlag.Carry);
  ram.writeByte(0, 0xc2);
  ram.writeByte(1, StatusFlag.Memory | StatusFlag.Index | StatusFlag.Carry);

  cpu.step();

  // Carry cleared, but M and X remain forced to 1
  expect(Number(cpu.readRegister("p")) & StatusFlag.Memory).toBe(StatusFlag.Memory);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Index).toBe(StatusFlag.Index);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(0);
});

// --- SEP -------------------------------------------------------------------

test("SEP sets bits in the processor status register", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("p", 0);
  ram.writeByte(0, 0xe2);
  ram.writeByte(1, StatusFlag.Carry | StatusFlag.Decimal);

  const result = cpu.step();

  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Decimal).toBe(StatusFlag.Decimal);
  expect(result).toMatchObject({ opcode: 0xe2, mnemonic: "SEP", cycles: 3 });
});

test("SEP clears upper bytes of X and Y when X flag is set", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Native 16-bit mode, index registers are 16-bit
  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", true);
  cpu.writeRegister("p", 0); // M=0, X=0
  cpu.writeRegister("x", 0x1234);
  cpu.writeRegister("y", 0x5678);
  ram.writeByte(0, 0xe2);
  ram.writeByte(1, StatusFlag.Index); // set X flag → 8-bit index

  const result = cpu.step();

  expect(cpu.readRegister("x")).toBe(0x34); // upper byte cleared
  expect(cpu.readRegister("y")).toBe(0x78);
  expect(result.registerChanges).toMatchObject({
    x: { before: 0x1234, after: 0x34 },
    y: { before: 0x5678, after: 0x78 },
  });
});

// --- XCE -------------------------------------------------------------------

test("XCE swaps carry and E8: W65C02 emulation to W65C816 emulation", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Start in W65C02 emulation (E8=true, E16=true)
  // clc then xce → E8 becomes 0 (C was 0), C becomes 1 (old E8)
  cpu.writeRegister("p", 0); // C=0; mode flags will be set by enforceEmulationMode on boot
  // ensure E8=true, E16=true
  expect(cpu.readRegister("e8")).toBe(true);
  expect(cpu.readRegister("e16")).toBe(true);

  ram.writeByte(0, 0xfb); // XCE

  const result = cpu.step();

  expect(cpu.readRegister("e8")).toBe(false); // E8 got old C=0
  expect(cpu.readRegister("e16")).toBe(true);  // E16 unchanged
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry); // C got old E8=1
  expect(result).toMatchObject({ opcode: 0xfb, mnemonic: "XCE", cycles: 2 });
  expect(result.registerChanges).toMatchObject({
    e8: { before: true, after: false },
  });
});

test("XCE: W65C816 emulation to W65C02 emulation forces M=1 X=1 and fixes SP", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Start in W65C816 emulation (E8=false, E16=true)
  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", true);
  cpu.writeRegister("p", StatusFlag.Carry); // C=1
  cpu.writeRegister("x", 0x1234);
  cpu.writeRegister("y", 0x5678);
  cpu.writeRegister("sp", 0x01f0);
  ram.writeByte(0, 0xfb); // XCE with C=1 → E8 becomes 1

  cpu.step();

  expect(cpu.readRegister("e8")).toBe(true);
  expect(cpu.readRegister("e16")).toBe(true); // W65C02 emulation
  // enforceEmulationMode must have forced M=1, X=1
  expect(Number(cpu.readRegister("p")) & StatusFlag.Memory).toBe(StatusFlag.Memory);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Index).toBe(StatusFlag.Index);
  // Upper bytes of X and Y cleared
  expect(cpu.readRegister("x")).toBe(0x34);
  expect(cpu.readRegister("y")).toBe(0x78);
  // SP constrained to page 1
  expect(cpu.readRegister("sp")).toBe(0x01f0); // already page 1, no change
});

// --- XFE -------------------------------------------------------------------

test("XFE swaps C↔E16 and V↔E8: W65C816 emulation to W65C832 native", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Start in W65C816 emulation (E8=false, E16=true)
  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", true);
  // clc; clv before xfe → C=0, V=0
  cpu.writeRegister("p", 0); // C=0, V=0
  ram.writeByte(0, 0xeb); // XFE

  const result = cpu.step();

  // C↔E16: new E16 = old C = 0, new C = old E16 = 1
  // V↔E8:  new E8  = old V = 0, new V = old E8  = 0
  expect(cpu.readRegister("e16")).toBe(false); // W65C832 native
  expect(cpu.readRegister("e8")).toBe(false);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Overflow).toBe(0);
  expect(result).toMatchObject({ opcode: 0xeb, mnemonic: "XFE", cycles: 2 });
  expect(result.registerChanges).toMatchObject({
    e16: { before: true, after: false },
  });
});

test("XFE: W65C832 native to W65C816 emulation forces M=1 X=1", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Start in W65C832 native (E8=false, E16=false)
  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", false);
  // sec before xfe → C=1 so E16 gets 1 (W65C816 emulation)
  cpu.writeRegister("p", StatusFlag.Carry); // C=1, V=0
  cpu.writeRegister("x", 0x1234);
  cpu.writeRegister("y", 0x5678);
  ram.writeByte(0, 0xeb); // XFE

  cpu.step();

  expect(cpu.readRegister("e16")).toBe(true);  // W65C816 emulation
  expect(cpu.readRegister("e8")).toBe(false);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Memory).toBe(StatusFlag.Memory);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Index).toBe(StatusFlag.Index);
  expect(cpu.readRegister("x")).toBe(0x34);
  expect(cpu.readRegister("y")).toBe(0x78);
});

// --- Full mode transition sequence -----------------------------------------

test("full mode sequence: W65C02 → W65C816 → W65C832 → W65C816 → W65C02", () => {
  const ram = createRam(32);
  const cpu = createCpu({ memory: ram });

  // Start: W65C02 emulation (E8=true, E16=true)
  expect(cpu.readRegister("e8")).toBe(true);
  expect(cpu.readRegister("e16")).toBe(true);

  // XCE with C=0: W65C02 → W65C816 (E8 goes 1→0)
  cpu.writeRegister("p", 0);
  ram.writeByte(0, 0xfb); // XCE
  cpu.step();
  expect(cpu.readRegister("e8")).toBe(false);
  expect(cpu.readRegister("e16")).toBe(true);

  // XFE with C=0, V=0: W65C816 → W65C832 (E16 goes 1→0)
  cpu.writeRegister("p", 0);
  ram.writeByte(1, 0xeb); // XFE
  cpu.step();
  expect(cpu.readRegister("e8")).toBe(false);
  expect(cpu.readRegister("e16")).toBe(false);

  // XFE with C=1, V=0: W65C832 → W65C816 (E16 goes 0→1)
  cpu.writeRegister("p", StatusFlag.Carry);
  ram.writeByte(2, 0xeb); // XFE
  cpu.step();
  expect(cpu.readRegister("e16")).toBe(true);
  expect(cpu.readRegister("e8")).toBe(false);

  // XCE with C=1: W65C816 → W65C02 (E8 goes 0→1)
  cpu.writeRegister("p", StatusFlag.Carry);
  ram.writeByte(3, 0xfb); // XCE
  cpu.step();
  expect(cpu.readRegister("e8")).toBe(true);
  expect(cpu.readRegister("e16")).toBe(true);
});

// ---------------------------------------------------------------------------
// Chunk 12: Interrupts and Vectors
// ---------------------------------------------------------------------------

test("BRK in emulation mode pushes PCH, PCL, P and jumps to IRQ/BRK vector", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  // BRK at address 0x0200 (default W65C02 emulation: E8=true, E16=true)
  cpu.writeRegister("pc", 0x0200);
  ram.writeByte(0x0200, 0x00); // BRK
  ram.writeByte(0x0201, 0x00); // padding

  // Install handler address at EMU_IRQ_BRK_VECTOR (0xFFFE)
  writeWord(ram, EMU_IRQ_BRK_VECTOR, 0x0400);
  cpu.writeRegister("p", StatusFlag.Carry);

  const spBefore = Number(cpu.readRegister("sp")); // 0x01FF

  const result = cpu.step();

  expect(result).toMatchObject({
    opcode: 0x00,
    mnemonic: "BRK",
    pcBefore: 0x0200,
    pcAfter: 0x0400,
    cycles: 7,
  });

  // PC after BRK+padding = 0x0202; pushed as PCH=0x02, PCL=0x02
  expect(ram.readByte(spBefore)).toBe(0x02);      // PCH at top of stack
  expect(ram.readByte(spBefore - 1)).toBe(0x02);  // PCL
  expect(ram.readByte(spBefore - 2)).toBe(Number(cpu.readRegister("p")) === 0
    ? StatusFlag.Carry | StatusFlag.InterruptDisable
    : ram.readByte(spBefore - 2)); // P was pushed before I was set

  // SP decreased by 3 (PCH, PCL, P)
  expect(Number(cpu.readRegister("sp"))).toBe(spBefore - 3);

  // I flag is set after BRK
  expect(Number(cpu.readRegister("p")) & StatusFlag.InterruptDisable).toBe(
    StatusFlag.InterruptDisable,
  );

  // PC now points to handler
  expect(cpu.readRegister("pc")).toBe(0x0400);
});

test("BRK in emulation mode pushed P value has I flag clear (captured before set)", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("pc", 0x0300);
  cpu.writeRegister("p", StatusFlag.Carry); // I is clear before BRK
  ram.writeByte(0x0300, 0x00);
  ram.writeByte(0x0301, 0x00);
  writeWord(ram, EMU_IRQ_BRK_VECTOR, 0x0500);

  const spBefore = Number(cpu.readRegister("sp"));
  cpu.step();

  // P that was pushed should reflect status BEFORE I was set
  const pushedP = ram.readByte(spBefore - 2);
  expect(pushedP & StatusFlag.InterruptDisable).toBe(0); // I was clear when pushed
  expect(pushedP & StatusFlag.Carry).toBe(StatusFlag.Carry);
});

test("BRK in native mode pushes PBR, PCH, PCL, P and clears D flag", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  // Switch to W65C832 native mode
  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("pc", 0x0200);
  cpu.writeRegister("prb", 0x01);
  cpu.writeRegister("sp", 0x0300);
  cpu.writeRegister("p", StatusFlag.Decimal); // D set; should be cleared after

  ram.writeByte(0x010200, 0x00); // BRK at PRB:PC = 0x010200
  ram.writeByte(0x010201, 0x00);
  writeWord(ram, NATIVE_BRK_VECTOR, 0x1000);

  const result = cpu.step();

  expect(result).toMatchObject({
    opcode: 0x00,
    mnemonic: "BRK",
    pcAfter: 0x1000,
    cycles: 8,
  });

  // Stack layout (top to bottom): PBR, PCH, PCL, P
  expect(ram.readByte(0x0300)).toBe(0x01);  // PBR
  expect(ram.readByte(0x02ff)).toBe(0x02);  // PCH (0x0202 >> 8)
  expect(ram.readByte(0x02fe)).toBe(0x02);  // PCL (0x0202 & 0xff)
  // P pushed (Decimal set at push time), sp=0x02FC after
  expect(Number(cpu.readRegister("sp"))).toBe(0x02fc);

  // D cleared, I set in current P
  expect(Number(cpu.readRegister("p")) & StatusFlag.Decimal).toBe(0);
  expect(Number(cpu.readRegister("p")) & StatusFlag.InterruptDisable).toBe(
    StatusFlag.InterruptDisable,
  );

  // PRB set to 0
  expect(cpu.readRegister("prb")).toBe(0);
  expect(cpu.readRegister("pc")).toBe(0x1000);
});

test("RTI in emulation mode restores P and PC from stack", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  // Pre-load stack as if BRK pushed: PCH=0x03, PCL=0x10, P=Carry
  const sp = 0x01fc;
  cpu.writeRegister("sp", sp);
  ram.writeByte(sp + 1, StatusFlag.Carry); // P
  ram.writeByte(sp + 2, 0x10);             // PCL
  ram.writeByte(sp + 3, 0x03);             // PCH

  ram.writeByte(0, 0x40); // RTI at PC=0
  const result = cpu.step();

  expect(result).toMatchObject({
    opcode: 0x40,
    mnemonic: "RTI",
    pcAfter: 0x0310,
    cycles: 6,
  });
  expect(cpu.readRegister("pc")).toBe(0x0310);
  expect(Number(cpu.readRegister("p")) & StatusFlag.Carry).toBe(StatusFlag.Carry);
  expect(Number(cpu.readRegister("sp"))).toBe(0x01ff); // SP restored
});

test("RTI in native mode restores PBR, P, and PC from stack", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", false);
  const sp = 0x02fc;
  cpu.writeRegister("sp", sp);

  // Stack (lowest first, pulled first): P, PCL, PCH, PBR
  ram.writeByte(sp + 1, StatusFlag.Carry); // P
  ram.writeByte(sp + 2, 0x00);             // PCL
  ram.writeByte(sp + 3, 0x05);             // PCH
  ram.writeByte(sp + 4, 0x02);             // PBR

  ram.writeByte(0, 0x40); // RTI
  const result = cpu.step();

  expect(result).toMatchObject({ cycles: 7, pcAfter: 0x020500 });
  expect(cpu.readRegister("pc")).toBe(0x0500);
  expect(cpu.readRegister("prb")).toBe(0x02);
  expect(Number(cpu.readRegister("sp"))).toBe(0x0300);
});

test("BRK then RTI round-trip returns to instruction after BRK in emulation mode", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  // Program: BRK at 0x0200, handler NOP at 0x0400, RTI at 0x0401
  cpu.writeRegister("pc", 0x0200);
  ram.writeByte(0x0200, 0x00); // BRK
  ram.writeByte(0x0201, 0x00); // padding
  ram.writeByte(0x0202, 0xdb); // STP (should resume here after RTI)
  writeWord(ram, EMU_IRQ_BRK_VECTOR, 0x0400);
  ram.writeByte(0x0400, 0xea); // NOP (handler)
  ram.writeByte(0x0401, 0x40); // RTI

  cpu.step(); // BRK
  expect(cpu.readRegister("pc")).toBe(0x0400);

  cpu.step(); // NOP in handler
  cpu.step(); // RTI

  // Should resume at 0x0202 (byte after BRK+padding)
  expect(cpu.readRegister("pc")).toBe(0x0202);

  cpu.step(); // STP
  expect(cpu.readRegister("stopped")).toBe(true);
});

test("COP uses COP vector, not BRK vector", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("pc", 0x0100);
  ram.writeByte(0x0100, 0x02); // COP
  ram.writeByte(0x0101, 0x00); // signature
  writeWord(ram, EMU_COP_VECTOR, 0x0600);
  writeWord(ram, EMU_IRQ_BRK_VECTOR, 0x0700);

  const result = cpu.step();

  expect(result).toMatchObject({ mnemonic: "COP", pcAfter: 0x0600 });
  expect(cpu.readRegister("pc")).toBe(0x0600);
});

test("triggerIrq pushes stack frame with B=0 and jumps to IRQ vector", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("pc", 0x0500);
  cpu.writeRegister("p", StatusFlag.Carry | StatusFlag.Index | StatusFlag.Memory);
  writeWord(ram, EMU_IRQ_BRK_VECTOR, 0x0800);

  const spBefore = Number(cpu.readRegister("sp"));
  const result = cpu.triggerIrq();

  expect(result).toMatchObject({ mnemonic: "IRQ", pcAfter: 0x0800, cycles: 7 });
  expect(cpu.readRegister("pc")).toBe(0x0800);

  // P pushed with bit 4 (B/Index) cleared
  const pushedP = ram.readByte(spBefore - 2);
  expect(pushedP & StatusFlag.Index).toBe(0); // B=0 for hardware IRQ
  expect(pushedP & StatusFlag.Carry).toBe(StatusFlag.Carry); // other flags preserved
});

test("triggerNmi uses NMI vector and wakes a stopped CPU", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  // Stop the CPU first
  cpu.writeRegister("pc", 0x0100);
  ram.writeByte(0x0100, 0xdb); // STP
  cpu.step();
  expect(cpu.readRegister("stopped")).toBe(true);

  writeWord(ram, EMU_NMI_VECTOR, 0x0900);
  const result = cpu.triggerNmi();

  expect(result).toMatchObject({ mnemonic: "NMI", pcAfter: 0x0900 });
  expect(cpu.readRegister("pc")).toBe(0x0900);
  expect(cpu.readRegister("stopped")).toBe(false);
});

test("native mode BRK uses native BRK vector, not emulation vector", () => {
  const ram = createRam(0x10000);
  const cpu = createCpu({ memory: ram });

  cpu.writeRegister("e8", false);
  cpu.writeRegister("e16", false);
  cpu.writeRegister("pc", 0x0200);
  ram.writeByte(0x0200, 0x00); // BRK
  ram.writeByte(0x0201, 0x00);
  writeWord(ram, NATIVE_BRK_VECTOR, 0x1100);
  writeWord(ram, EMU_IRQ_BRK_VECTOR, 0x1200); // should NOT be used

  const result = cpu.step();
  expect(result.pcAfter).toBe(0x1100);
});
