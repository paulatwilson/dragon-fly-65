import { createClockConfig, type ClockConfig } from "./clock";
import {
  BYTE_MASK,
  EMU_ABORT_VECTOR,
  EMU_COP_VECTOR,
  EMU_IRQ_BRK_VECTOR,
  EMU_NMI_VECTOR,
  NATIVE_ABORT_VECTOR,
  NATIVE_BRK_VECTOR,
  NATIVE_COP_VECTOR,
  NATIVE_IRQ_VECTOR,
  NATIVE_NMI_VECTOR,
  RESET_VECTOR_ADDRESS,
  type RegisterWidth,
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
  maskForWidth,
  maskToWidth,
  resolveWidthMode,
  setStatusFlag,
  updateNegativeZeroFlags,
} from "./state";
import type {
  CpuOptions,
  CpuState,
  RegisterChange,
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

  readMemoryValue(address: number, width: RegisterWidth): number {
    let value = this.memory.readByte(address);
    if (width >= 16) value |= this.memory.readByte(address + 1) << 8;
    if (width === 32) {
      value |= this.memory.readByte(address + 2) << 16;
      value |= this.memory.readByte(address + 3) << 24;
    }
    return maskToWidth(value, width);
  }

  resolveDirectAddress(operandBytes: number[]): number {
    return makeDirectAddress(this.state.dr, operandBytes[0] ?? 0);
  }

  resolveDirectIndexedXAddress(operandBytes: number[]): number {
    const { index } = resolveWidthMode(this.state);
    return (
      (this.state.dr & WORD_MASK) +
      (operandBytes[0] ?? 0) +
      maskToWidth(this.state.x, index)
    ) & WORD_MASK;
  }

  resolveDirectIndexedYAddress(operandBytes: number[]): number {
    const { index } = resolveWidthMode(this.state);
    return (
      (this.state.dr & WORD_MASK) +
      (operandBytes[0] ?? 0) +
      maskToWidth(this.state.y, index)
    ) & WORD_MASK;
  }

  resolveAbsoluteAddress(operandBytes: number[]): number {
    return makeDataAddress(this.state.drb, this.readBytesValue(operandBytes));
  }

  resolveAbsoluteIndexedXAddress(operandBytes: number[]): number {
    const { index } = resolveWidthMode(this.state);
    const base = this.readBytesValue(operandBytes);
    return makeDataAddress(
      this.state.drb,
      (base + maskToWidth(this.state.x, index)) & WORD_MASK,
    );
  }

  resolveAbsoluteIndexedYAddress(operandBytes: number[]): number {
    const { index } = resolveWidthMode(this.state);
    const base = this.readBytesValue(operandBytes);
    return makeDataAddress(
      this.state.drb,
      (base + maskToWidth(this.state.y, index)) & WORD_MASK,
    );
  }

  resolveLongAbsoluteAddress(operandBytes: number[]): number {
    const word = (operandBytes[0] ?? 0) | ((operandBytes[1] ?? 0) << 8);
    const bank = operandBytes[2] ?? 0;
    return makeDataAddress(bank, word);
  }

  resolveIndirectAddress(operandBytes: number[]): number {
    const pointer = makeDirectAddress(this.state.dr, operandBytes[0] ?? 0);
    const word = readWord(this.memory, pointer);
    return makeDataAddress(this.state.drb, word);
  }

  resolveIndirectIndexedYAddress(operandBytes: number[]): number {
    const pointer = makeDirectAddress(this.state.dr, operandBytes[0] ?? 0);
    const base = readWord(this.memory, pointer);
    return makeDataAddress(this.state.drb, (base + this.state.y) & WORD_MASK);
  }

  resolveStackRelativeAddress(operandBytes: number[]): number {
    return (this.state.sp + (operandBytes[0] ?? 0)) & WORD_MASK;
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

  getStackAddress(): number {
    if (this.state.e16 && this.state.e8) {
      return 0x0100 | (this.state.sp & BYTE_MASK);
    }

    return this.state.sp & WORD_MASK;
  }

  pushByte(value: number): void {
    this.memory.writeByte(this.getStackAddress(), value);
    this.state.sp = this.nextStackPointer(-1);
  }

  pullByte(): number {
    this.state.sp = this.nextStackPointer(1);
    return this.memory.readByte(this.getStackAddress());
  }

  pushValue(value: number, width: RegisterWidth): void {
    const byteCount = width / 8;

    for (let index = byteCount - 1; index >= 0; index -= 1) {
      this.pushByte(value >> (index * 8));
    }
  }

  pullValue(width: RegisterWidth): number {
    const byteCount = width / 8;
    let value = 0;

    for (let index = 0; index < byteCount; index += 1) {
      value |= this.pullByte() << (index * 8);
    }

    return maskToWidth(value, width);
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
    const cycles = 2 + this.accWidthPenalty();
    this.state.cycles += cycles;

    return this.completeRegisterInstruction(
      context,
      "a",
      before,
      value,
      statusBefore,
      cycles,
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
    const cycles = 2 + this.idxWidthPenalty();
    this.state.cycles += cycles;

    return this.completeRegisterInstruction(
      context,
      "x",
      before,
      value,
      statusBefore,
      cycles,
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
    const cycles = 2 + this.idxWidthPenalty();
    this.state.cycles += cycles;

    return this.completeRegisterInstruction(
      context,
      "y",
      before,
      value,
      statusBefore,
      cycles,
    );
  }

  completeStoreAccumulatorDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveDirectAddress(context.operandBytes), this.state.a, accumulator, 3 + this.accWidthPenalty() + this.dpPenalty(),
    );
  }

  completeStoreAccumulatorAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteAddress(context.operandBytes), this.state.a, accumulator, 4 + this.accWidthPenalty(),
    );
  }

  completeStoreAccumulatorDirectIndexedX(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveDirectIndexedXAddress(context.operandBytes), this.state.a, accumulator, 4 + this.accWidthPenalty() + this.dpPenalty(),
    );
  }

  completeStoreAccumulatorAbsoluteIndexedX(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteIndexedXAddress(context.operandBytes), this.state.a, accumulator, 5 + this.accWidthPenalty(),
    );
  }

  completeStoreAccumulatorAbsoluteIndexedY(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteIndexedYAddress(context.operandBytes), this.state.a, accumulator, 5 + this.accWidthPenalty(),
    );
  }

  completeStoreAccumulatorLong(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveLongAbsoluteAddress(context.operandBytes), this.state.a, accumulator, 5 + this.accWidthPenalty(),
    );
  }

  completeStoreAccumulatorIndirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveIndirectAddress(context.operandBytes), this.state.a, accumulator, 5 + this.accWidthPenalty() + this.dpPenalty(),
    );
  }

  completeStoreAccumulatorIndirectIndexedY(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveIndirectIndexedYAddress(context.operandBytes), this.state.a, accumulator, 6 + this.accWidthPenalty(),
    );
  }

  completeStoreAccumulatorStackRelative(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveStackRelativeAddress(context.operandBytes), this.state.a, accumulator, 4 + this.accWidthPenalty(),
    );
  }

  completeStoreXDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveDirectAddress(context.operandBytes), this.state.x, index, 3 + this.idxWidthPenalty() + this.dpPenalty(),
    );
  }

  completeStoreXAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteAddress(context.operandBytes), this.state.x, index, 4 + this.idxWidthPenalty(),
    );
  }

  completeStoreYDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveDirectAddress(context.operandBytes), this.state.y, index, 3 + this.idxWidthPenalty() + this.dpPenalty(),
    );
  }

  completeStoreYAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteAddress(context.operandBytes), this.state.y, index, 4 + this.idxWidthPenalty(),
    );
  }

  completeLoadAccumulatorDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveDirectAddress(context.operandBytes), 3 + this.accWidthPenalty() + this.dpPenalty(),
    );
  }

  completeLoadAccumulatorAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveAbsoluteAddress(context.operandBytes), 4 + this.accWidthPenalty(),
    );
  }

  completeLoadAccumulatorDirectIndexedX(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveDirectIndexedXAddress(context.operandBytes), 4 + this.accWidthPenalty() + this.dpPenalty(),
    );
  }

  completeLoadAccumulatorAbsoluteIndexedX(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveAbsoluteIndexedXAddress(context.operandBytes), 4 + this.accWidthPenalty(),
    );
  }

  completeLoadAccumulatorAbsoluteIndexedY(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveAbsoluteIndexedYAddress(context.operandBytes), 4 + this.accWidthPenalty(),
    );
  }

  completeLoadAccumulatorLong(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveLongAbsoluteAddress(context.operandBytes), 5 + this.accWidthPenalty(),
    );
  }

  completeLoadAccumulatorIndirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveIndirectAddress(context.operandBytes), 5 + this.accWidthPenalty() + this.dpPenalty(),
    );
  }

  completeLoadAccumulatorIndirectIndexedY(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveIndirectIndexedYAddress(context.operandBytes), 5 + this.accWidthPenalty(),
    );
  }

  completeLoadAccumulatorStackRelative(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveStackRelativeAddress(context.operandBytes), 4 + this.accWidthPenalty(),
    );
  }

  completeLoadXDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "x", index, this.resolveDirectAddress(context.operandBytes), 3 + this.idxWidthPenalty() + this.dpPenalty(),
    );
  }

  completeLoadXAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "x", index, this.resolveAbsoluteAddress(context.operandBytes), 4 + this.idxWidthPenalty(),
    );
  }

  completeLoadYDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "y", index, this.resolveDirectAddress(context.operandBytes), 3 + this.idxWidthPenalty() + this.dpPenalty(),
    );
  }

  completeLoadYAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "y", index, this.resolveAbsoluteAddress(context.operandBytes), 4 + this.idxWidthPenalty(),
    );
  }

  completePushAccumulator(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const stackBefore = this.state.sp;
    const cycles = 3 + this.accWidthPenalty();

    this.pushValue(this.state.a, accumulator);
    this.state.cycles += cycles;

    return this.completeStackInstruction(context, stackBefore, cycles);
  }

  completePullAccumulator(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const stackBefore = this.state.sp;
    const accumulatorBefore = this.state.a;
    const statusBefore = this.state.p;
    const cycles = 4 + this.accWidthPenalty();
    const value = this.pullValue(accumulator);

    this.state.a = value;
    updateNegativeZeroFlags(this.state, value, accumulator);
    this.state.cycles += cycles;

    return this.completeStackInstruction(context, stackBefore, cycles, {
      a:
        accumulatorBefore === value
          ? undefined
          : { before: accumulatorBefore, after: value },
      p:
        statusBefore === this.state.p
          ? undefined
          : { before: statusBefore, after: this.state.p },
    });
  }

  completePushProcessorStatus(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;

    this.pushByte(this.state.p);
    this.state.cycles += 3;

    return this.completeStackInstruction(context, stackBefore, 3);
  }

  completePullProcessorStatus(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;
    const statusBefore = this.state.p;
    const value = this.pullByte() & BYTE_MASK;

    this.state.p = value;
    this.state.cycles += 4;

    return this.completeStackInstruction(context, stackBefore, 4, {
      p:
        statusBefore === value
          ? undefined
          : { before: statusBefore, after: value },
    });
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

  completeTransferCToStack(context: InstructionContext): StepResult {
    const before = this.state.sp;
    const statusBefore = this.state.p;
    // TCS always uses the full 16-bit C register regardless of M flag
    const value = this.state.a & WORD_MASK;
    this.state.sp = value;
    this.state.cycles += 2;
    return this.completeRegisterInstruction(context, "sp", before, value, statusBefore, 2);
  }

  completeTransferStackToC(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const before = this.state.a;
    const statusBefore = this.state.p;
    // TSC always transfers the full 16-bit SP into C (regardless of M flag)
    const value = this.state.sp & WORD_MASK;
    this.state.a = value;
    updateNegativeZeroFlags(this.state, value, 16);
    this.state.cycles += 2;
    return this.completeRegisterInstruction(context, "a", before, maskToWidth(value, accumulator), statusBefore, 2);
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

  completeJumpToSubroutine(context: InstructionContext): StepResult {
    const target = this.readBytesValue(context.operandBytes) & WORD_MASK;
    // Push PC-1 (last byte of JSR instruction) high byte first — WDC convention.
    // By the time execute() runs, PC has already advanced past all 3 bytes.
    const returnAddress = (this.state.pc - 1) & WORD_MASK;
    const stackBefore = this.state.sp;

    this.pushByte(returnAddress >> 8);
    this.pushByte(returnAddress & BYTE_MASK);
    this.state.pc = target;
    this.state.cycles += 6;

    return this.completeStackInstruction(context, stackBefore, 6);
  }

  completeReturnFromSubroutine(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;
    const low = this.pullByte();
    const high = this.pullByte();
    const returnAddress = ((high << 8) | low) & WORD_MASK;

    this.state.pc = (returnAddress + 1) & WORD_MASK;
    this.state.cycles += 6;

    return this.completeStackInstruction(context, stackBefore, 6);
  }

  completeResetProcessorStatus(context: InstructionContext): StepResult {
    const mask = context.operandBytes[0] ?? 0;
    const statusBefore = this.state.p;
    // In W65C02 emulation mode (e16 && e8) M and X cannot be cleared.
    // In W65C816 native mode (e16 && !e8) or W65C832 native mode (!e16), REP clears freely.
    const effectiveMask = (this.state.e16 && this.state.e8)
      ? mask & ~(StatusFlag.Memory | StatusFlag.Index) & BYTE_MASK
      : mask;

    this.state.p = (this.state.p & ~effectiveMask) & BYTE_MASK;
    this.state.cycles += 3;

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "REP",
      bytes: context.bytes,
      cycles: 3,
      stopped: false,
      registerChanges:
        statusBefore !== this.state.p
          ? { p: { before: statusBefore, after: this.state.p } }
          : {},
    };
  }

  completeSetProcessorStatus(context: InstructionContext): StepResult {
    const mask = context.operandBytes[0] ?? 0;
    const statusBefore = this.state.p;
    const xBefore = this.state.x;
    const yBefore = this.state.y;

    this.state.p = (this.state.p | mask) & BYTE_MASK;
    this.enforceIndexWidth();
    this.state.cycles += 3;

    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    if (xBefore !== this.state.x) registerChanges.x = { before: xBefore, after: this.state.x };
    if (yBefore !== this.state.y) registerChanges.y = { before: yBefore, after: this.state.y };

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "SEP",
      bytes: context.bytes,
      cycles: 3,
      stopped: false,
      registerChanges,
    };
  }

  completeExchangeCarryEmulation(context: InstructionContext): StepResult {
    const prevE8 = this.state.e8;
    const prevCarry = (this.state.p & StatusFlag.Carry) !== 0;
    const snap = { e8: prevE8, p: this.state.p, x: this.state.x, y: this.state.y, sp: this.state.sp };

    this.state.e8 = prevCarry;
    setStatusFlag(this.state, StatusFlag.Carry, prevE8);
    this.enforceEmulationMode();
    this.state.cycles += 2;

    const registerChanges: StepResult["registerChanges"] = {};
    if (snap.e8 !== this.state.e8) registerChanges.e8 = { before: snap.e8, after: this.state.e8 };
    if (snap.p !== this.state.p) registerChanges.p = { before: snap.p, after: this.state.p };
    if (snap.x !== this.state.x) registerChanges.x = { before: snap.x, after: this.state.x };
    if (snap.y !== this.state.y) registerChanges.y = { before: snap.y, after: this.state.y };
    if (snap.sp !== this.state.sp) registerChanges.sp = { before: snap.sp, after: this.state.sp };

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "XCE",
      bytes: context.bytes,
      cycles: 2,
      stopped: false,
      registerChanges,
    };
  }

  completeExchangeFullEmulation(context: InstructionContext): StepResult {
    const prevE16 = this.state.e16;
    const prevE8 = this.state.e8;
    const prevCarry = (this.state.p & StatusFlag.Carry) !== 0;
    const prevOverflow = (this.state.p & StatusFlag.Overflow) !== 0;
    const snap = { e16: prevE16, e8: prevE8, p: this.state.p, x: this.state.x, y: this.state.y, sp: this.state.sp };

    // C ↔ E16, V ↔ E8
    this.state.e16 = prevCarry;
    this.state.e8 = prevOverflow;
    setStatusFlag(this.state, StatusFlag.Carry, prevE16);
    setStatusFlag(this.state, StatusFlag.Overflow, prevE8);
    this.enforceEmulationMode();
    this.state.cycles += 2;

    const registerChanges: StepResult["registerChanges"] = {};
    if (snap.e16 !== this.state.e16) registerChanges.e16 = { before: snap.e16, after: this.state.e16 };
    if (snap.e8 !== this.state.e8) registerChanges.e8 = { before: snap.e8, after: this.state.e8 };
    if (snap.p !== this.state.p) registerChanges.p = { before: snap.p, after: this.state.p };
    if (snap.x !== this.state.x) registerChanges.x = { before: snap.x, after: this.state.x };
    if (snap.y !== this.state.y) registerChanges.y = { before: snap.y, after: this.state.y };
    if (snap.sp !== this.state.sp) registerChanges.sp = { before: snap.sp, after: this.state.sp };

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "XFE",
      bytes: context.bytes,
      cycles: 2,
      stopped: false,
      registerChanges,
    };
  }

  completeBranchAlways(context: InstructionContext): StepResult {
    const offset = context.operandBytes[0] ?? 0;
    const signed = offset >= 0x80 ? offset - 0x100 : offset;
    const newPc = (this.state.pc + signed) & WORD_MASK;
    const pageCross =
      this.state.e8 &&
      this.state.e16 &&
      (newPc & 0xff00) !== (this.state.pc & 0xff00);
    const cycles = pageCross ? 4 : 3;
    this.state.pc = newPc;
    this.state.cycles += cycles;
    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "BRA",
      bytes: context.bytes,
      cycles,
      stopped: false,
      registerChanges: {},
    };
  }

  completeBranch(
    context: InstructionContext,
    flag: StatusFlag,
    flagMustBeSet: boolean,
  ): StepResult {
    const offset = context.operandBytes[0] ?? 0;
    const signed = offset >= 0x80 ? offset - 0x100 : offset;
    const flagIsSet = (this.state.p & flag) !== 0;
    const taken = flagIsSet === flagMustBeSet;

    let cycles = 2;
    if (taken) {
      const newPc = (this.state.pc + signed) & WORD_MASK;
      const pageCross =
        this.state.e8 &&
        this.state.e16 &&
        (newPc & 0xff00) !== (this.state.pc & 0xff00);
      cycles = pageCross ? 4 : 3;
      this.state.pc = newPc;
    }

    this.state.cycles += cycles;

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: getOpcodeDefinition(context.opcode)?.mnemonic ?? "???",
      bytes: context.bytes,
      cycles,
      stopped: false,
    };
  }

  completeJumpAbsolute(context: InstructionContext): StepResult {
    const address = this.readBytesValue(context.operandBytes) & WORD_MASK;

    this.state.pc = address;
    this.state.cycles += 3;

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "JMP",
      bytes: context.bytes,
      cycles: 3,
      stopped: false,
    };
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

  completeAndImmediate(context: InstructionContext): StepResult {
    return this.completeBitwiseImmediateInstruction(context, (a, b) => a & b);
  }

  completeOrImmediate(context: InstructionContext): StepResult {
    return this.completeBitwiseImmediateInstruction(context, (a, b) => a | b);
  }

  completeExclusiveOrImmediate(context: InstructionContext): StepResult {
    return this.completeBitwiseImmediateInstruction(context, (a, b) => a ^ b);
  }

  completeAddWithCarryImmediate(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const operand = maskToWidth(
      this.readBytesValue(context.operandBytes),
      accumulator,
    );
    return this.completeAdderInstruction(context, operand, accumulator);
  }

  completeSubtractWithCarryImmediate(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const rawOperand = maskToWidth(
      this.readBytesValue(context.operandBytes),
      accumulator,
    );
    // SBC: A - M - (1-C) = A + ~M + C
    const operand = (~rawOperand) & maskForWidth(accumulator);
    return this.completeAdderInstruction(context, operand, accumulator);
  }

  completeCompareAccumulatorImmediate(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeCompareInstruction(context, "a", accumulator);
  }

  completeCompareXImmediate(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeCompareInstruction(context, "x", index);
  }

  completeCompareYImmediate(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeCompareInstruction(context, "y", index);
  }

  private interruptVector(native: number, emulation: number): number {
    return this.state.e16 ? emulation : native;
  }

  private enterInterrupt(vector: number, clearBit4InEmulation: boolean): void {
    const pToPush =
      clearBit4InEmulation && this.state.e16
        ? (this.state.p & ~StatusFlag.Index) & BYTE_MASK
        : this.state.p & BYTE_MASK;

    if (!this.state.e16) {
      this.pushByte(this.state.prb);
    }
    this.pushByte((this.state.pc >> 8) & BYTE_MASK);
    this.pushByte(this.state.pc & BYTE_MASK);
    this.pushByte(pToPush);

    setStatusFlag(this.state, StatusFlag.InterruptDisable, true);
    if (!this.state.e16) {
      setStatusFlag(this.state, StatusFlag.Decimal, false);
    }

    this.state.pc = readWord(this.memory, vector);
    if (!this.state.e16) {
      this.state.prb = 0;
    }
  }

  private buildInterruptResult(
    pcBefore: number,
    mnemonic: string,
    bytes: number[],
    stackBefore: number,
    statusBefore: number,
    cycles: number,
  ): StepResult {
    const registerChanges: StepResult["registerChanges"] = {};
    if (stackBefore !== this.state.sp) {
      registerChanges.sp = { before: stackBefore, after: this.state.sp };
    }
    if (statusBefore !== this.state.p) {
      registerChanges.p = { before: statusBefore, after: this.state.p };
    }
    return {
      pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: bytes[0] ?? 0,
      mnemonic,
      bytes,
      cycles,
      stopped: false,
      registerChanges,
    };
  }

  private completeInterruptInstruction(
    context: InstructionContext,
    mnemonic: string,
    nativeVector: number,
    emuVector: number,
  ): StepResult {
    const isEmulation = this.state.e16;
    const vector = this.interruptVector(nativeVector, emuVector);
    const stackBefore = this.state.sp;
    const statusBefore = this.state.p;
    const cycles = isEmulation ? 7 : 8;

    this.enterInterrupt(vector, false);
    this.state.cycles += cycles;

    return this.buildInterruptResult(
      context.pcBefore,
      mnemonic,
      context.bytes,
      stackBefore,
      statusBefore,
      cycles,
    );
  }

  completeBrkInstruction(context: InstructionContext): StepResult {
    return this.completeInterruptInstruction(
      context, "BRK", NATIVE_BRK_VECTOR, EMU_IRQ_BRK_VECTOR,
    );
  }

  completeCopInstruction(context: InstructionContext): StepResult {
    return this.completeInterruptInstruction(
      context, "COP", NATIVE_COP_VECTOR, EMU_COP_VECTOR,
    );
  }

  completeReturnFromInterrupt(context: InstructionContext): StepResult {
    const isEmulation = this.state.e16;
    const stackBefore = this.state.sp;
    const statusBefore = this.state.p;
    const cycles = isEmulation ? 6 : 7;

    this.state.p = this.pullByte() & BYTE_MASK;
    const pcl = this.pullByte();
    const pch = this.pullByte();
    this.state.pc = ((pch << 8) | pcl) & WORD_MASK;
    if (!isEmulation) {
      this.state.prb = this.pullByte() & BYTE_MASK;
    }
    this.state.cycles += cycles;

    const registerChanges: StepResult["registerChanges"] = {};
    if (stackBefore !== this.state.sp) {
      registerChanges.sp = { before: stackBefore, after: this.state.sp };
    }
    if (statusBefore !== this.state.p) {
      registerChanges.p = { before: statusBefore, after: this.state.p };
    }

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: "RTI",
      bytes: context.bytes,
      cycles,
      stopped: false,
      registerChanges,
    };
  }

  triggerIrq(): StepResult {
    const isEmulation = this.state.e16;
    const pcBefore = makeProgramAddress(this.state.prb, this.state.pc);
    const vector = this.interruptVector(NATIVE_IRQ_VECTOR, EMU_IRQ_BRK_VECTOR);
    const stackBefore = this.state.sp;
    const statusBefore = this.state.p;
    const cycles = isEmulation ? 7 : 8;

    this.state.stopped = false;
    this.enterInterrupt(vector, true); // clear bit 4 → hardware IRQ, not BRK
    this.state.cycles += cycles;

    return this.buildInterruptResult(pcBefore, "IRQ", [], stackBefore, statusBefore, cycles);
  }

  triggerNmi(): StepResult {
    const isEmulation = this.state.e16;
    const pcBefore = makeProgramAddress(this.state.prb, this.state.pc);
    const vector = this.interruptVector(NATIVE_NMI_VECTOR, EMU_NMI_VECTOR);
    const stackBefore = this.state.sp;
    const statusBefore = this.state.p;
    const cycles = isEmulation ? 7 : 8;

    this.state.stopped = false;
    this.enterInterrupt(vector, true);
    this.state.cycles += cycles;

    return this.buildInterruptResult(pcBefore, "NMI", [], stackBefore, statusBefore, cycles);
  }

  triggerAbort(): StepResult {
    const isEmulation = this.state.e16;
    const pcBefore = makeProgramAddress(this.state.prb, this.state.pc);
    const vector = this.interruptVector(NATIVE_ABORT_VECTOR, EMU_ABORT_VECTOR);
    const stackBefore = this.state.sp;
    const statusBefore = this.state.p;
    const cycles = isEmulation ? 7 : 8;

    this.state.stopped = false;
    this.enterInterrupt(vector, true);
    this.state.cycles += cycles;

    return this.buildInterruptResult(pcBefore, "ABORT", [], stackBefore, statusBefore, cycles);
  }

  // --- Shift/rotate compute helpers ----------------------------------------

  private computeAsl(value: number, width: RegisterWidth, _carry: boolean): [number, boolean] {
    const carryOut = width === 32 ? (value >>> 31) !== 0 : ((value >> (width - 1)) & 1) !== 0;
    const result = width === 32 ? (value << 1) >>> 0 : (value << 1) & maskForWidth(width);
    return [result, carryOut];
  }

  private computeLsr(value: number, width: RegisterWidth, _carry: boolean): [number, boolean] {
    const carryOut = (value & 1) !== 0;
    const result = width === 32 ? value >>> 1 : (value >> 1) & maskForWidth(width);
    return [result, carryOut];
  }

  private computeRol(value: number, width: RegisterWidth, carryIn: boolean): [number, boolean] {
    const carryOut = width === 32 ? (value >>> 31) !== 0 : ((value >> (width - 1)) & 1) !== 0;
    const bit = carryIn ? 1 : 0;
    const result = width === 32
      ? ((value << 1) | bit) >>> 0
      : ((value << 1) | bit) & maskForWidth(width);
    return [result, carryOut];
  }

  private computeRor(value: number, width: RegisterWidth, carryIn: boolean): [number, boolean] {
    const carryOut = (value & 1) !== 0;
    const bit = carryIn ? 1 : 0;
    const result = width === 32
      ? ((value >>> 1) | (bit << 31)) >>> 0
      : ((value >> 1) | (bit << (width - 1))) & maskForWidth(width);
    return [result, carryOut];
  }

  // --- Shift/rotate executors -----------------------------------------------

  private completeShiftAccumulator(
    context: InstructionContext,
    fn: (v: number, w: RegisterWidth, c: boolean) => [number, boolean],
    cycles: number,
  ): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const before = this.state.a;
    const statusBefore = this.state.p;
    const carryIn = (this.state.p & StatusFlag.Carry) !== 0;
    const [result, carryOut] = fn(maskToWidth(before, accumulator), accumulator, carryIn);

    this.state.a = result;
    updateNegativeZeroFlags(this.state, result, accumulator);
    setStatusFlag(this.state, StatusFlag.Carry, carryOut);
    this.state.cycles += cycles;

    return this.completeRegisterInstruction(context, "a", before, result, statusBefore, cycles);
  }

  private completeShiftMemory(
    context: InstructionContext,
    address: number,
    fn: (v: number, w: RegisterWidth, c: boolean) => [number, boolean],
    cycles: number,
  ): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const value = this.readMemoryValue(address, accumulator);
    const statusBefore = this.state.p;
    const carryIn = (this.state.p & StatusFlag.Carry) !== 0;
    const [result, carryOut] = fn(value, accumulator, carryIn);

    this.writeMemoryValue(address, result, accumulator);
    updateNegativeZeroFlags(this.state, result, accumulator);
    setStatusFlag(this.state, StatusFlag.Carry, carryOut);
    this.state.cycles += cycles;

    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: getOpcodeDefinition(context.opcode)?.mnemonic ?? "???",
      bytes: context.bytes,
      cycles,
      stopped: false,
      effectiveAddress: address,
      registerChanges,
    };
  }

  // --- Bitwise-on-value helper (extracted for memory-mode ALU reuse) ---------

  private completeBitwiseOnValue(
    context: InstructionContext,
    operand: number,
    fn: (a: number, b: number) => number,
    accumulator: RegisterWidth,
    cycles: number,
  ): StepResult {
    const before = this.state.a;
    const statusBefore = this.state.p;
    const result = maskToWidth(fn(maskToWidth(before, accumulator), operand), accumulator);

    this.state.a = result;
    updateNegativeZeroFlags(this.state, result, accumulator);
    this.state.cycles += cycles;

    return this.completeRegisterInstruction(context, "a", before, result, statusBefore, cycles);
  }

  // --- Public shifts/rotates ------------------------------------------------

  completeAslAccumulator(context: InstructionContext): StepResult {
    return this.completeShiftAccumulator(context, (v, w, c) => this.computeAsl(v, w, c), 2);
  }
  completeLsrAccumulator(context: InstructionContext): StepResult {
    return this.completeShiftAccumulator(context, (v, w, c) => this.computeLsr(v, w, c), 2);
  }
  completeRolAccumulator(context: InstructionContext): StepResult {
    return this.completeShiftAccumulator(context, (v, w, c) => this.computeRol(v, w, c), 2);
  }
  completeRorAccumulator(context: InstructionContext): StepResult {
    return this.completeShiftAccumulator(context, (v, w, c) => this.computeRor(v, w, c), 2);
  }

  completeAslDirect(context: InstructionContext): StepResult {
    return this.completeShiftMemory(context, this.resolveDirectAddress(context.operandBytes), (v, w, c) => this.computeAsl(v, w, c), 5);
  }
  completeLsrDirect(context: InstructionContext): StepResult {
    return this.completeShiftMemory(context, this.resolveDirectAddress(context.operandBytes), (v, w, c) => this.computeLsr(v, w, c), 5);
  }
  completeRolDirect(context: InstructionContext): StepResult {
    return this.completeShiftMemory(context, this.resolveDirectAddress(context.operandBytes), (v, w, c) => this.computeRol(v, w, c), 5);
  }
  completeRorDirect(context: InstructionContext): StepResult {
    return this.completeShiftMemory(context, this.resolveDirectAddress(context.operandBytes), (v, w, c) => this.computeRor(v, w, c), 5);
  }

  completeAslAbsolute(context: InstructionContext): StepResult {
    return this.completeShiftMemory(context, this.resolveAbsoluteAddress(context.operandBytes), (v, w, c) => this.computeAsl(v, w, c), 6);
  }
  completeLsrAbsolute(context: InstructionContext): StepResult {
    return this.completeShiftMemory(context, this.resolveAbsoluteAddress(context.operandBytes), (v, w, c) => this.computeLsr(v, w, c), 6);
  }
  completeRolAbsolute(context: InstructionContext): StepResult {
    return this.completeShiftMemory(context, this.resolveAbsoluteAddress(context.operandBytes), (v, w, c) => this.computeRol(v, w, c), 6);
  }
  completeRorAbsolute(context: InstructionContext): StepResult {
    return this.completeShiftMemory(context, this.resolveAbsoluteAddress(context.operandBytes), (v, w, c) => this.computeRor(v, w, c), 6);
  }

  // --- Bit tests ------------------------------------------------------------

  completeBitImmediate(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const value = maskToWidth(this.readBytesValue(context.operandBytes), accumulator);
    const a = maskToWidth(this.state.a, accumulator);
    const statusBefore = this.state.p;

    const cycles = 2 + this.accWidthPenalty();
    setStatusFlag(this.state, StatusFlag.Zero, (a & value) === 0);
    this.state.cycles += cycles;

    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "BIT",
      bytes: context.bytes, cycles, stopped: false, registerChanges,
    };
  }

  private completeBitMemory(context: InstructionContext, address: number, cycles: number): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const value = this.readMemoryValue(address, accumulator);
    const a = maskToWidth(this.state.a, accumulator);
    const statusBefore = this.state.p;
    const signBit = accumulator === 32 ? 0x8000_0000 : 1 << (accumulator - 1);

    setStatusFlag(this.state, StatusFlag.Zero, (a & value) === 0);
    setStatusFlag(this.state, StatusFlag.Negative, (value & signBit) !== 0);
    setStatusFlag(this.state, StatusFlag.Overflow, (value & (signBit >> 1)) !== 0);
    this.state.cycles += cycles;

    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "BIT",
      bytes: context.bytes, cycles, stopped: false, effectiveAddress: address, registerChanges,
    };
  }

  completeBitDirect(context: InstructionContext): StepResult {
    return this.completeBitMemory(context, this.resolveDirectAddress(context.operandBytes), 3 + this.accWidthPenalty() + this.dpPenalty());
  }
  completeBitAbsolute(context: InstructionContext): StepResult {
    return this.completeBitMemory(context, this.resolveAbsoluteAddress(context.operandBytes), 4 + this.accWidthPenalty());
  }

  private completeTestBitsInstruction(
    context: InstructionContext,
    address: number,
    cycles: number,
    applyFn: (memory: number, a: number, width: RegisterWidth) => number,
  ): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const value = this.readMemoryValue(address, accumulator);
    const a = maskToWidth(this.state.a, accumulator);
    const statusBefore = this.state.p;
    const result = maskToWidth(applyFn(value, a, accumulator), accumulator);

    setStatusFlag(this.state, StatusFlag.Zero, (a & value) === 0);
    this.writeMemoryValue(address, result, accumulator);
    this.state.cycles += cycles;

    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: getOpcodeDefinition(context.opcode)?.mnemonic ?? "???",
      bytes: context.bytes, cycles, stopped: false, effectiveAddress: address, registerChanges,
    };
  }

  completeTsbDirect(context: InstructionContext): StepResult {
    return this.completeTestBitsInstruction(context, this.resolveDirectAddress(context.operandBytes), 5, (m, a) => m | a);
  }
  completeTsbAbsolute(context: InstructionContext): StepResult {
    return this.completeTestBitsInstruction(context, this.resolveAbsoluteAddress(context.operandBytes), 6, (m, a) => m | a);
  }
  completeTrbDirect(context: InstructionContext): StepResult {
    return this.completeTestBitsInstruction(context, this.resolveDirectAddress(context.operandBytes), 5, (m, a, w) => m & (~a & maskForWidth(w)));
  }
  completeTrbAbsolute(context: InstructionContext): StepResult {
    return this.completeTestBitsInstruction(context, this.resolveAbsoluteAddress(context.operandBytes), 6, (m, a, w) => m & (~a & maskForWidth(w)));
  }

  // --- INC/DEC accumulator and memory ---------------------------------------

  completeIncrementAccumulator(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const before = this.state.a;
    const statusBefore = this.state.p;
    const value = maskToWidth(maskToWidth(before, accumulator) + 1, accumulator);

    this.state.a = value;
    updateNegativeZeroFlags(this.state, value, accumulator);
    this.state.cycles += 2;
    return this.completeRegisterInstruction(context, "a", before, value, statusBefore, 2);
  }

  completeDecrementAccumulator(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const before = this.state.a;
    const statusBefore = this.state.p;
    const value = maskToWidth(maskToWidth(before, accumulator) - 1, accumulator);

    this.state.a = value;
    updateNegativeZeroFlags(this.state, value, accumulator);
    this.state.cycles += 2;
    return this.completeRegisterInstruction(context, "a", before, value, statusBefore, 2);
  }

  private completeIncDecMemory(
    context: InstructionContext,
    address: number,
    delta: 1 | -1,
    cycles: number,
  ): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const value = this.readMemoryValue(address, accumulator);
    const statusBefore = this.state.p;
    const result = maskToWidth(value + delta, accumulator);

    this.writeMemoryValue(address, result, accumulator);
    updateNegativeZeroFlags(this.state, result, accumulator);
    this.state.cycles += cycles;

    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode,
      mnemonic: getOpcodeDefinition(context.opcode)?.mnemonic ?? "???",
      bytes: context.bytes, cycles, stopped: false, effectiveAddress: address, registerChanges,
    };
  }

  completeIncrementDirect(context: InstructionContext): StepResult {
    return this.completeIncDecMemory(context, this.resolveDirectAddress(context.operandBytes), 1, 5);
  }
  completeIncrementAbsolute(context: InstructionContext): StepResult {
    return this.completeIncDecMemory(context, this.resolveAbsoluteAddress(context.operandBytes), 1, 6);
  }
  completeDecrementDirect(context: InstructionContext): StepResult {
    return this.completeIncDecMemory(context, this.resolveDirectAddress(context.operandBytes), -1, 5);
  }
  completeDecrementAbsolute(context: InstructionContext): StepResult {
    return this.completeIncDecMemory(context, this.resolveAbsoluteAddress(context.operandBytes), -1, 6);
  }

  // --- STZ ------------------------------------------------------------------

  private completeStoreZero(context: InstructionContext, address: number, cycles: number): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    this.writeMemoryValue(address, 0, accumulator);
    this.state.cycles += cycles;
    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "STZ",
      bytes: context.bytes, cycles, stopped: false, effectiveAddress: address,
    };
  }

  completeStoreZeroDirect(context: InstructionContext): StepResult {
    return this.completeStoreZero(context, this.resolveDirectAddress(context.operandBytes), 3 + this.accWidthPenalty() + this.dpPenalty());
  }
  completeStoreZeroAbsolute(context: InstructionContext): StepResult {
    return this.completeStoreZero(context, this.resolveAbsoluteAddress(context.operandBytes), 4 + this.accWidthPenalty());
  }

  // --- Push/pull X, Y, B, D, K ----------------------------------------------

  completePushX(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const stackBefore = this.state.sp;
    const cycles = 3 + this.idxWidthPenalty();
    this.pushValue(this.state.x, index);
    this.state.cycles += cycles;
    return this.completeStackInstruction(context, stackBefore, cycles);
  }

  completePullX(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const stackBefore = this.state.sp;
    const before = this.state.x;
    const statusBefore = this.state.p;
    const cycles = 4 + this.idxWidthPenalty();
    const value = this.pullValue(index);
    this.state.x = value;
    updateNegativeZeroFlags(this.state, value, index);
    this.state.cycles += cycles;
    return this.completeStackInstruction(context, stackBefore, cycles, {
      x: before === value ? undefined : { before, after: value },
      p: statusBefore === this.state.p ? undefined : { before: statusBefore, after: this.state.p },
    });
  }

  completePushY(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const stackBefore = this.state.sp;
    const cycles = 3 + this.idxWidthPenalty();
    this.pushValue(this.state.y, index);
    this.state.cycles += cycles;
    return this.completeStackInstruction(context, stackBefore, cycles);
  }

  completePullY(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const stackBefore = this.state.sp;
    const before = this.state.y;
    const statusBefore = this.state.p;
    const cycles = 4 + this.idxWidthPenalty();
    const value = this.pullValue(index);
    this.state.y = value;
    updateNegativeZeroFlags(this.state, value, index);
    this.state.cycles += cycles;
    return this.completeStackInstruction(context, stackBefore, cycles, {
      y: before === value ? undefined : { before, after: value },
      p: statusBefore === this.state.p ? undefined : { before: statusBefore, after: this.state.p },
    });
  }

  completePushDataBank(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;
    this.pushByte(this.state.drb);
    this.state.cycles += 3;
    return this.completeStackInstruction(context, stackBefore, 3);
  }

  completePullDataBank(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;
    const before = this.state.drb;
    this.state.drb = this.pullByte() & BYTE_MASK;
    this.state.cycles += 4;
    const changes = before === this.state.drb ? {} : { drb: { before, after: this.state.drb } };
    return this.completeStackInstruction(context, stackBefore, 4, changes);
  }

  completePushDirect(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;
    this.pushByte(this.state.dr >> 8);
    this.pushByte(this.state.dr & BYTE_MASK);
    this.state.cycles += 4;
    return this.completeStackInstruction(context, stackBefore, 4);
  }

  completePullDirect(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;
    const before = this.state.dr;
    const low = this.pullByte();
    const high = this.pullByte();
    this.state.dr = ((high << 8) | low) & WORD_MASK;
    this.state.cycles += 5;
    const changes = before === this.state.dr ? {} : { dr: { before, after: this.state.dr } };
    return this.completeStackInstruction(context, stackBefore, 5, changes);
  }

  completePushProgramBank(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;
    this.pushByte(this.state.prb);
    this.state.cycles += 3;
    return this.completeStackInstruction(context, stackBefore, 3);
  }

  // --- Long jumps -----------------------------------------------------------

  completeJumpLong(context: InstructionContext): StepResult {
    const newPc = (context.operandBytes[0] ?? 0) | ((context.operandBytes[1] ?? 0) << 8);
    const newPrb = context.operandBytes[2] ?? 0;
    this.state.pc = newPc & WORD_MASK;
    this.state.prb = newPrb & BYTE_MASK;
    this.state.cycles += 4;
    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "JML",
      bytes: context.bytes, cycles: 4, stopped: false,
    };
  }

  completeJumpSubroutineLong(context: InstructionContext): StepResult {
    const target = this.resolveLongAbsoluteAddress(context.operandBytes);
    const targetPc = target & WORD_MASK;
    const targetPrb = (target >> 16) & BYTE_MASK;
    // Return address: current PRB and PC-1 (last byte of JSL instruction)
    const returnPc = (this.state.pc - 1) & WORD_MASK;
    const stackBefore = this.state.sp;

    this.pushByte(this.state.prb);
    this.pushByte(returnPc >> 8);
    this.pushByte(returnPc & BYTE_MASK);
    this.state.pc = targetPc;
    this.state.prb = targetPrb;
    this.state.cycles += 8;

    return this.completeStackInstruction(context, stackBefore, 8);
  }

  completeReturnSubroutineLong(context: InstructionContext): StepResult {
    const stackBefore = this.state.sp;
    const low = this.pullByte();
    const high = this.pullByte();
    const prb = this.pullByte();
    this.state.pc = (((high << 8) | low) + 1) & WORD_MASK;
    this.state.prb = prb & BYTE_MASK;
    this.state.cycles += 6;
    return this.completeStackInstruction(context, stackBefore, 6);
  }

  completeJumpIndirectAbsolute(context: InstructionContext): StepResult {
    const pointer = this.readBytesValue(context.operandBytes) & WORD_MASK;
    const target = readWord(this.memory, pointer) & WORD_MASK;
    this.state.pc = target;
    this.state.cycles += 5;
    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "JMP",
      bytes: context.bytes, cycles: 5, stopped: false, effectiveAddress: pointer,
    };
  }

  // --- Block moves ----------------------------------------------------------

  private completeMoveBlock(
    context: InstructionContext,
    mnemonic: string,
    delta: 1 | -1,
  ): StepResult {
    const dstBank = context.operandBytes[0] ?? 0;
    const srcBank = context.operandBytes[1] ?? 0;
    const { accumulator } = resolveWidthMode(this.state);
    const count = maskToWidth(this.state.a, accumulator) + 1;

    for (let i = 0; i < count; i += 1) {
      const srcAddr = makeDataAddress(srcBank, maskToWidth(this.state.x, 16));
      const dstAddr = makeDataAddress(dstBank, maskToWidth(this.state.y, 16));
      this.memory.writeByte(dstAddr, this.memory.readByte(srcAddr));
      this.state.x = maskToWidth(this.state.x + delta, 16);
      this.state.y = maskToWidth(this.state.y + delta, 16);
    }

    this.state.a = maskToWidth(0xffff, accumulator);
    this.state.drb = dstBank & BYTE_MASK;
    this.state.cycles += 7 * count;

    return {
      pcBefore: context.pcBefore,
      pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic,
      bytes: context.bytes, cycles: 7 * count, stopped: false,
    };
  }

  completeMoveBlockNext(context: InstructionContext): StepResult {
    return this.completeMoveBlock(context, "MVN", 1);
  }

  completeMoveBlockPrevious(context: InstructionContext): StepResult {
    return this.completeMoveBlock(context, "MVP", -1);
  }

  // --- ALU direct-page variants (reuse adder/bitwise helpers) ---------------

  completeAddWithCarryDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveDirectAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeAdderInstruction(context, operand, accumulator, 3 + this.dpPenalty());
  }

  completeSubtractWithCarryDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveDirectAddress(context.operandBytes);
    const raw = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeAdderInstruction(context, (~raw) & maskForWidth(accumulator), accumulator, 3 + this.dpPenalty());
  }

  completeAndDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveDirectAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeBitwiseOnValue(context, operand, (a, b) => a & b, accumulator, 3);
  }

  completeOrDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveDirectAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeBitwiseOnValue(context, operand, (a, b) => a | b, accumulator, 3);
  }

  completeExclusiveOrDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveDirectAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeBitwiseOnValue(context, operand, (a, b) => a ^ b, accumulator, 3);
  }

  completeCompareAccumulatorDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveDirectAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    const regValue = maskToWidth(this.state.a, accumulator);
    const statusBefore = this.state.p;
    const cycles = 3 + this.accWidthPenalty() + this.dpPenalty();
    updateNegativeZeroFlags(this.state, maskToWidth(regValue - operand, accumulator), accumulator);
    setStatusFlag(this.state, StatusFlag.Carry, regValue >= operand);
    this.state.cycles += cycles;
    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    return {
      pcBefore: context.pcBefore, pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "CMP", bytes: context.bytes, cycles, stopped: false, registerChanges,
    };
  }

  completeAddWithCarryAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveAbsoluteAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeAdderInstruction(context, operand, accumulator, 4);
  }

  completeSubtractWithCarryAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveAbsoluteAddress(context.operandBytes);
    const raw = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeAdderInstruction(context, (~raw) & maskForWidth(accumulator), accumulator, 4);
  }

  completeAndAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveAbsoluteAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeBitwiseOnValue(context, operand, (a, b) => a & b, accumulator, 4 + this.accWidthPenalty());
  }

  completeOrAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveAbsoluteAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeBitwiseOnValue(context, operand, (a, b) => a | b, accumulator, 4 + this.accWidthPenalty());
  }

  completeExclusiveOrAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveAbsoluteAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    return this.completeBitwiseOnValue(context, operand, (a, b) => a ^ b, accumulator, 4 + this.accWidthPenalty());
  }

  completeCompareAccumulatorAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const address = this.resolveAbsoluteAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, accumulator), accumulator);
    const regValue = maskToWidth(this.state.a, accumulator);
    const statusBefore = this.state.p;
    const cycles = 4 + this.accWidthPenalty();
    updateNegativeZeroFlags(this.state, maskToWidth(regValue - operand, accumulator), accumulator);
    setStatusFlag(this.state, StatusFlag.Carry, regValue >= operand);
    this.state.cycles += cycles;
    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    return {
      pcBefore: context.pcBefore, pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "CMP", bytes: context.bytes, cycles, stopped: false, registerChanges,
    };
  }

  completeCompareXDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const address = this.resolveDirectAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, index), index);
    const regValue = maskToWidth(this.state.x, index);
    const statusBefore = this.state.p;
    const cycles = 3 + this.idxWidthPenalty() + this.dpPenalty();
    updateNegativeZeroFlags(this.state, maskToWidth(regValue - operand, index), index);
    setStatusFlag(this.state, StatusFlag.Carry, regValue >= operand);
    this.state.cycles += cycles;
    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    return {
      pcBefore: context.pcBefore, pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "CPX", bytes: context.bytes, cycles, stopped: false, registerChanges,
    };
  }

  completeCompareYDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    const address = this.resolveDirectAddress(context.operandBytes);
    const operand = maskToWidth(this.readMemoryValue(address, index), index);
    const regValue = maskToWidth(this.state.y, index);
    const statusBefore = this.state.p;
    const cycles = 3 + this.idxWidthPenalty() + this.dpPenalty();
    updateNegativeZeroFlags(this.state, maskToWidth(regValue - operand, index), index);
    setStatusFlag(this.state, StatusFlag.Carry, regValue >= operand);
    this.state.cycles += cycles;
    const registerChanges: StepResult["registerChanges"] = {};
    if (statusBefore !== this.state.p) registerChanges.p = { before: statusBefore, after: this.state.p };
    return {
      pcBefore: context.pcBefore, pcAfter: makeProgramAddress(this.state.prb, this.state.pc),
      opcode: context.opcode, mnemonic: "CPY", bytes: context.bytes, cycles, stopped: false, registerChanges,
    };
  }

  // --- LDX/STX direct indexed Y --------------------------------------------

  completeLoadXDirectIndexedY(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "x", index, this.resolveDirectIndexedYAddress(context.operandBytes), 4 + this.idxWidthPenalty() + this.dpPenalty(),
    );
  }

  completeStoreXDirectIndexedY(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveDirectIndexedYAddress(context.operandBytes), this.state.x, index, 4 + this.idxWidthPenalty() + this.dpPenalty(),
    );
  }

  private enforceIndexWidth(): void {
    if (this.state.p & StatusFlag.Index) {
      this.state.x = this.state.x & BYTE_MASK;
      this.state.y = this.state.y & BYTE_MASK;
    }
  }

  private enforceEmulationMode(): void {
    if (this.state.e16) {
      this.state.p = (this.state.p | StatusFlag.Memory | StatusFlag.Index) & BYTE_MASK;
      this.state.x = this.state.x & BYTE_MASK;
      this.state.y = this.state.y & BYTE_MASK;
      if (this.state.e8) {
        this.state.sp = 0x0100 | (this.state.sp & BYTE_MASK);
      }
    }
  }

  private completeLoadFromAddress(
    context: InstructionContext,
    register: "a" | "x" | "y",
    width: RegisterWidth,
    address: number,
    cycles: number,
  ): StepResult {
    const value = this.readMemoryValue(address, width);
    const before = this.state[register];
    const statusBefore = this.state.p;
    const registerChanges: StepResult["registerChanges"] = {};

    this.state[register] = value;
    updateNegativeZeroFlags(this.state, value, width);
    this.state.cycles += cycles;

    if (before !== value) registerChanges[register] = { before, after: value };
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
      effectiveAddress: address,
      registerChanges,
    };
  }

  private completeBitwiseImmediateInstruction(
    context: InstructionContext,
    fn: (a: number, b: number) => number,
  ): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const operand = maskToWidth(this.readBytesValue(context.operandBytes), accumulator);
    return this.completeBitwiseOnValue(context, operand, fn, accumulator, 2 + this.accWidthPenalty());
  }

  private completeAdderInstruction(
    context: InstructionContext,
    operand: number,
    accumulator: RegisterWidth,
    baseCycles = 2,
  ): StepResult {
    const mask = maskForWidth(accumulator);
    const a = maskToWidth(this.state.a, accumulator);
    const carryIn = (this.state.p & StatusFlag.Carry) !== 0 ? 1 : 0;
    const before = this.state.a;
    const statusBefore = this.state.p;

    const sum = a + operand + carryIn;
    const result = maskToWidth(sum, accumulator);
    const signBit = accumulator === 32 ? 0x8000_0000 : 1 << (accumulator - 1);

    this.state.a = result;
    updateNegativeZeroFlags(this.state, result, accumulator);
    setStatusFlag(this.state, StatusFlag.Carry, sum > mask);
    setStatusFlag(
      this.state,
      StatusFlag.Overflow,
      ((~(a ^ operand) & (a ^ result)) & signBit) !== 0,
    );
    const cycles = baseCycles + this.accWidthPenalty();
    this.state.cycles += cycles;

    return this.completeRegisterInstruction(
      context,
      "a",
      before,
      result,
      statusBefore,
      cycles,
    );
  }

  private completeCompareInstruction(
    context: InstructionContext,
    register: "a" | "x" | "y",
    width: RegisterWidth,
  ): StepResult {
    const operand = maskToWidth(
      this.readBytesValue(context.operandBytes),
      width,
    );
    const regValue = maskToWidth(this.state[register], width);
    const statusBefore = this.state.p;

    const cycles = 2 + this.widthPenalty(width);
    updateNegativeZeroFlags(this.state, maskToWidth(regValue - operand, width), width);
    setStatusFlag(this.state, StatusFlag.Carry, regValue >= operand);
    this.state.cycles += cycles;

    // Register is unchanged; only status may change
    return this.completeRegisterInstruction(
      context,
      register,
      this.state[register],
      this.state[register],
      statusBefore,
      cycles,
    );
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

  private completeStackInstruction(
    context: InstructionContext,
    stackBefore: number,
    cycles: number,
    extraChanges: Record<string, RegisterChange | undefined> = {},
  ): StepResult {
    const registerChanges: StepResult["registerChanges"] = {};

    if (stackBefore !== this.state.sp) {
      registerChanges.sp = {
        before: stackBefore,
        after: this.state.sp,
      };
    }

    for (const [register, change] of Object.entries(extraChanges)) {
      if (change !== undefined) {
        registerChanges[register] = change;
      }
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

  private nextStackPointer(delta: -1 | 1): number {
    if (this.state.e16 && this.state.e8) {
      return 0x0100 | ((this.state.sp + delta) & BYTE_MASK);
    }

    return (this.state.sp + delta) & WORD_MASK;
  }

  private widthPenalty(width: RegisterWidth): number {
    return width === 8 ? 0 : width === 16 ? 1 : 3;
  }

  private accWidthPenalty(): number {
    return this.widthPenalty(resolveWidthMode(this.state).accumulator);
  }

  private idxWidthPenalty(): number {
    return this.widthPenalty(resolveWidthMode(this.state).index);
  }

  private dpPenalty(): number {
    return (this.state.dr & 0xff) !== 0 ? 1 : 0;
  }
}

export function createCpu(options: CpuOptions): W65C832Cpu {
  return new W65C832Cpu(options);
}
