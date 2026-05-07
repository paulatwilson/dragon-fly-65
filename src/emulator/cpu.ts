import { createClockConfig, type ClockConfig } from "./clock";
import {
  BYTE_MASK,
  RESET_VECTOR_ADDRESS,
  StatusFlag,
  WORD_MASK,
} from "./constants";
import {
  makeDataAddress,
  makeDirectAddress,
  makeProgramAddress,
  readWord,
} from "./memory";
import { getOpcodeDefinition, type InstructionContext } from "./opcodes";
import {
  createInitialCpuState,
  maskToWidth,
  resolveWidthMode,
  setStatusFlag,
  updateNegativeZeroFlags,
} from "./state";
import type {
  CpuOptions,
  CpuState,
  RegisterName,
  StepResult,
  WidthMode,
} from "./types";

export class UnsupportedOpcodeError extends Error {
  constructor(opcode: number) {
    super(`Unsupported W65C832 opcode: 0x${opcode.toString(16).padStart(2, "0")}`);
    this.name = "UnsupportedOpcodeError";
  }
}

export class W65C832Cpu {
  readonly memory: CpuOptions["memory"];
  readonly clock: ClockConfig;
  readonly state: CpuState;

  constructor(options: CpuOptions) {
    this.memory = options.memory;
    this.clock = createClockConfig(options.clockHz);
    this.state = createInitialCpuState();
  }

  reset(): void {
    const fresh = createInitialCpuState();
    fresh.pc = readWord(this.memory, RESET_VECTOR_ADDRESS);
    Object.assign(this.state, fresh);
  }

  readRegister(name: RegisterName): CpuState[RegisterName] {
    return this.state[name];
  }

  writeRegister(name: RegisterName, value: CpuState[RegisterName]): void {
    switch (name) {
      case "a":
      case "x":
      case "y":
      case "cycles":
        this.state[name] = Number(value) >>> 0;
        break;
      case "sp":
      case "pc":
      case "dr":
        this.state[name] = Number(value) & WORD_MASK;
        break;
      case "drb":
      case "prb":
      case "p":
        this.state[name] = Number(value) & BYTE_MASK;
        break;
      case "e8":
      case "e16":
      case "stopped":
        this.state[name] = Boolean(value);
        break;
    }
  }

  getWidthMode(): WidthMode {
    return resolveWidthMode(this.state);
  }

  step(): StepResult {
    if (this.state.stopped) {
      return {
        pcBefore: makeProgramAddress(this.state.prb, this.state.pc),
        pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
        opcode: 0,
        mnemonic: "STOPPED",
        bytes: [],
        cycles: 0,
        stopped: true,
      };
    }

    const pcBefore = makeProgramAddress(this.state.prb, this.state.pc);
    const opcode = this.fetchByte();
    const definition = getOpcodeDefinition(opcode);

    if (definition === undefined) {
      throw new UnsupportedOpcodeError(opcode);
    }

    const bytes = [opcode];
    const byteLength = definition.byteLength(this);
    for (let index = 1; index < byteLength; index += 1) {
      bytes.push(this.fetchByte());
    }

    return definition.execute(this, {
      pcBefore,
      opcode,
      bytes,
      operandBytes: bytes.slice(1),
    });
  }

  readBytesValue(bytes: number[]): number {
    let value = 0;

    for (const [index, byte] of bytes.entries()) {
      value |= (byte & BYTE_MASK) << (index * 8);
    }

    return value >>> 0;
  }

  fetchByte(): number {
    const address = makeProgramAddress(this.state.prb, this.state.pc);
    const value = this.memory.readByte(address);
    this.state.pc = (this.state.pc + 1) & WORD_MASK;

    return value & BYTE_MASK;
  }

  fetchWord(): number {
    const low = this.fetchByte();
    const high = this.fetchByte();

    return ((high << 8) | low) & WORD_MASK;
  }

  fetchLong(): number {
    const byte0 = this.fetchByte();
    const byte1 = this.fetchByte();
    const byte2 = this.fetchByte();
    const byte3 = this.fetchByte();

    return (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0;
  }

  fetchAccumulatorImmediate(): number {
    const { accumulator } = resolveWidthMode(this.state);

    switch (accumulator) {
      case 8:
        return this.fetchByte();
      case 16:
        return this.fetchWord();
      case 32:
        return this.fetchLong();
    }
  }

  fetchIndexImmediate(): number {
    const { index } = resolveWidthMode(this.state);

    switch (index) {
      case 8:
        return this.fetchByte();
      case 16:
        return this.fetchWord();
      case 32:
        return this.fetchLong();
    }
  }

  writeMemoryValue(address: number, value: number, width: 8 | 16 | 32): void {
    const normalized = maskToWidth(value, width);

    this.memory.writeByte(address, normalized);

    if (width >= 16) {
      this.memory.writeByte(address + 1, normalized >> 8);
    }

    if (width === 32) {
      this.memory.writeByte(address + 2, normalized >> 16);
      this.memory.writeByte(address + 3, normalized >> 24);
    }
  }

  completeFlagInstruction(
    context: InstructionContext,
    flag: StatusFlag,
    enabled: boolean,
  ): StepResult {
    const statusBefore = this.state.p;
    setStatusFlag(this.state, flag, enabled);
    const statusAfter = this.state.p;
    this.state.cycles += 2;

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: getOpcodeDefinition(context.opcode)?.mnemonic ?? "???",
      bytes: context.bytes,
      cycles: 2,
      stopped: false,
      registerChanges:
        statusBefore === statusAfter
          ? {}
          : {
              p: {
                before: statusBefore,
                after: statusAfter,
              },
            },
    };
  }

  completeLoadAccumulatorImmediate(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const value = maskToWidth(
      this.readBytesValue(context.operandBytes),
      accumulator,
    ) >>> 0;
    const before = this.state.a;
    const statusBefore = this.state.p;

    this.state.a = value;
    updateNegativeZeroFlags(this.state, value, accumulator);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "a",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeLoadXImmediate(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const value =
      maskToWidth(this.readBytesValue(context.operandBytes), index) >>> 0;
    const before = this.state.x;
    const statusBefore = this.state.p;

    this.state.x = value;
    updateNegativeZeroFlags(this.state, value, index);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "x",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeLoadYImmediate(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const value =
      maskToWidth(this.readBytesValue(context.operandBytes), index) >>> 0;
    const before = this.state.y;
    const statusBefore = this.state.p;

    this.state.y = value;
    updateNegativeZeroFlags(this.state, value, index);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "y",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeStoreAccumulatorDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const effectiveAddress = makeDirectAddress(
      this.state.dr,
      context.operandBytes[0] ?? 0,
    );

    return this.completeStoreInstruction(
      context,
      effectiveAddress,
      this.state.a,
      accumulator,
      3,
    );
  }

  completeStoreAccumulatorAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const effectiveAddress = makeDataAddress(
      this.state.drb,
      this.readBytesValue(context.operandBytes),
    );

    return this.completeStoreInstruction(
      context,
      effectiveAddress,
      this.state.a,
      accumulator,
      4,
    );
  }

  completeStoreXDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const effectiveAddress = makeDirectAddress(
      this.state.dr,
      context.operandBytes[0] ?? 0,
    );

    return this.completeStoreInstruction(
      context,
      effectiveAddress,
      this.state.x,
      index,
      3,
    );
  }

  completeStoreXAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const effectiveAddress = makeDataAddress(
      this.state.drb,
      this.readBytesValue(context.operandBytes),
    );

    return this.completeStoreInstruction(
      context,
      effectiveAddress,
      this.state.x,
      index,
      4,
    );
  }

  completeStoreYDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const effectiveAddress = makeDirectAddress(
      this.state.dr,
      context.operandBytes[0] ?? 0,
    );

    return this.completeStoreInstruction(
      context,
      effectiveAddress,
      this.state.y,
      index,
      3,
    );
  }

  completeStoreYAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const effectiveAddress = makeDataAddress(
      this.state.drb,
      this.readBytesValue(context.operandBytes),
    );

    return this.completeStoreInstruction(
      context,
      effectiveAddress,
      this.state.y,
      index,
      4,
    );
  }

  completeTransferAccumulatorToX(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const before = this.state.x;
    const statusBefore = this.state.p;
    const value = maskToWidth(this.state.a, index);

    this.state.x = value;
    updateNegativeZeroFlags(this.state, value, index);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "x",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeTransferAccumulatorToY(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const before = this.state.y;
    const statusBefore = this.state.p;
    const value = maskToWidth(this.state.a, index);

    this.state.y = value;
    updateNegativeZeroFlags(this.state, value, index);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "y",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeTransferXToAccumulator(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const before = this.state.a;
    const statusBefore = this.state.p;
    const value = maskToWidth(this.state.x, accumulator);

    this.state.a = value;
    updateNegativeZeroFlags(this.state, value, accumulator);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "a",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeTransferYToAccumulator(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const before = this.state.a;
    const statusBefore = this.state.p;
    const value = maskToWidth(this.state.y, accumulator);

    this.state.a = value;
    updateNegativeZeroFlags(this.state, value, accumulator);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "a",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeTransferXToStack(context: InstructionContext): StepResult {
    const before = this.state.sp;
    const statusBefore = this.state.p;
    const value = this.state.x & WORD_MASK;

    this.state.sp = value;
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "sp",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeTransferStackToX(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const before = this.state.x;
    const statusBefore = this.state.p;
    const value = maskToWidth(this.state.sp, index);

    this.state.x = value;
    updateNegativeZeroFlags(this.state, value, index);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "x",
      before,
      value,
      statusBefore,
      2,
    );
  }

  completeIncrementX(context: InstructionContext): StepResult {
    return this.completeIndexMathInstruction(context, "x", 1);
  }

  completeIncrementY(context: InstructionContext): StepResult {
    return this.completeIndexMathInstruction(context, "y", 1);
  }

  completeDecrementX(context: InstructionContext): StepResult {
    return this.completeIndexMathInstruction(context, "x", -1);
  }

  completeDecrementY(context: InstructionContext): StepResult {
    return this.completeIndexMathInstruction(context, "y", -1);
  }

  completeNoopInstruction(context: InstructionContext): StepResult {
    this.state.cycles += 2;

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "NOP",
      bytes: context.bytes,
      cycles: 2,
      stopped: false,
    };
  }

  completeStopInstruction(context: InstructionContext): StepResult {
    const stoppedBefore = this.state.stopped;
    this.state.stopped = true;
    this.state.cycles += 3;

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "STP",
      bytes: context.bytes,
      cycles: 3,
      stopped: true,
      registerChanges: {
        stopped: {
          before: stoppedBefore,
          after: true,
        },
      },
    };
  }

  private completeRegisterInstruction(
    context: InstructionContext,
    register: "a" | "sp" | "x" | "y",
    before: number,
    after: number,
    statusBefore: number,
    cycles: number,
  ): StepResult {
    const registerChanges: StepResult["registerChanges"] = {};

    if (before !== after) {
      registerChanges[register] = { before, after };
    }

    if (statusBefore !== this.state.p) {
      registerChanges.p = { before: statusBefore, after: this.state.p };
    }

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: getOpcodeDefinition(context.opcode)?.mnemonic ?? "???",
      bytes: context.bytes,
      cycles,
      stopped: false,
      registerChanges,
    };
  }

  private completeIndexMathInstruction(
    context: InstructionContext,
    register: "x" | "y",
    delta: -1 | 1,
  ): StepResult {
    const { index } = resolveWidthMode(this.state);
    const before = this.state[register];
    const statusBefore = this.state.p;
    const value = maskToWidth(before + delta, index);

    this.state[register] = value;
    updateNegativeZeroFlags(this.state, value, index);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      register,
      before,
      value,
      statusBefore,
      2,
    );
  }

  private completeStoreInstruction(
    context: InstructionContext,
    effectiveAddress: number,
    value: number,
    width: 8 | 16 | 32,
    cycles: number,
  ): StepResult {
    this.writeMemoryValue(effectiveAddress, value, width);
    this.state.cycles += cycles;

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: getOpcodeDefinition(context.opcode)?.mnemonic ?? "???",
      bytes: context.bytes,
      cycles,
      stopped: false,
      effectiveAddress,
    };
  }
}

export function createCpu(options: CpuOptions): W65C832Cpu {
  return new W65C832Cpu(options);
}
