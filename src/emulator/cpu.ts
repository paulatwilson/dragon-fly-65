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
    return this.completeStoreInstruction(
      context, this.resolveDirectAddress(context.operandBytes), this.state.a, accumulator, 3,
    );
  }

  completeStoreAccumulatorAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteAddress(context.operandBytes), this.state.a, accumulator, 4,
    );
  }

  completeStoreAccumulatorDirectIndexedX(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveDirectIndexedXAddress(context.operandBytes), this.state.a, accumulator, 4,
    );
  }

  completeStoreAccumulatorAbsoluteIndexedX(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteIndexedXAddress(context.operandBytes), this.state.a, accumulator, 5,
    );
  }

  completeStoreAccumulatorAbsoluteIndexedY(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteIndexedYAddress(context.operandBytes), this.state.a, accumulator, 5,
    );
  }

  completeStoreAccumulatorLong(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveLongAbsoluteAddress(context.operandBytes), this.state.a, accumulator, 5,
    );
  }

  completeStoreAccumulatorIndirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveIndirectAddress(context.operandBytes), this.state.a, accumulator, 5,
    );
  }

  completeStoreAccumulatorStackRelative(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveStackRelativeAddress(context.operandBytes), this.state.a, accumulator, 4,
    );
  }

  completeStoreXDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveDirectAddress(context.operandBytes), this.state.x, index, 3,
    );
  }

  completeStoreXAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteAddress(context.operandBytes), this.state.x, index, 4,
    );
  }

  completeStoreYDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveDirectAddress(context.operandBytes), this.state.y, index, 3,
    );
  }

  completeStoreYAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeStoreInstruction(
      context, this.resolveAbsoluteAddress(context.operandBytes), this.state.y, index, 4,
    );
  }

  completeLoadAccumulatorDirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveDirectAddress(context.operandBytes), 3,
    );
  }

  completeLoadAccumulatorAbsolute(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveAbsoluteAddress(context.operandBytes), 4,
    );
  }

  completeLoadAccumulatorDirectIndexedX(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveDirectIndexedXAddress(context.operandBytes), 4,
    );
  }

  completeLoadAccumulatorAbsoluteIndexedX(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveAbsoluteIndexedXAddress(context.operandBytes), 4,
    );
  }

  completeLoadAccumulatorAbsoluteIndexedY(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveAbsoluteIndexedYAddress(context.operandBytes), 4,
    );
  }

  completeLoadAccumulatorLong(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveLongAbsoluteAddress(context.operandBytes), 5,
    );
  }

  completeLoadAccumulatorIndirect(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveIndirectAddress(context.operandBytes), 5,
    );
  }

  completeLoadAccumulatorStackRelative(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "a", accumulator, this.resolveStackRelativeAddress(context.operandBytes), 4,
    );
  }

  completeLoadXDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "x", index, this.resolveDirectAddress(context.operandBytes), 3,
    );
  }

  completeLoadXAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "x", index, this.resolveAbsoluteAddress(context.operandBytes), 4,
    );
  }

  completeLoadYDirect(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "y", index, this.resolveDirectAddress(context.operandBytes), 3,
    );
  }

  completeLoadYAbsolute(context: InstructionContext): StepResult {
    const { index } = resolveWidthMode(this.state);
    return this.completeLoadFromAddress(
      context, "y", index, this.resolveAbsoluteAddress(context.operandBytes), 4,
    );
  }

  completePushAccumulator(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const stackBefore = this.state.sp;

    this.pushValue(this.state.a, accumulator);
    this.state.cycles += 3;

    return this.completeStackInstruction(context, stackBefore, 3);
  }

  completePullAccumulator(context: InstructionContext): StepResult {
    const { accumulator } = resolveWidthMode(this.state);
    const stackBefore = this.state.sp;
    const accumulatorBefore = this.state.a;
    const statusBefore = this.state.p;
    const value = this.pullValue(accumulator);

    this.state.a = value;
    updateNegativeZeroFlags(this.state, value, accumulator);
    this.state.cycles += 4;

    return this.completeStackInstruction(context, stackBefore, 4, {
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
    // In emulation mode M and X cannot be cleared — they stay forced to 1.
    const effectiveMask = this.state.e16
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
    const operand = maskToWidth(
      this.readBytesValue(context.operandBytes),
      accumulator,
    );
    const before = this.state.a;
    const statusBefore = this.state.p;
    const result = maskToWidth(
      fn(maskToWidth(before, accumulator), operand),
      accumulator,
    );

    this.state.a = result;
    updateNegativeZeroFlags(this.state, result, accumulator);
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "a",
      before,
      result,
      statusBefore,
      2,
    );
  }

  private completeAdderInstruction(
    context: InstructionContext,
    operand: number,
    accumulator: RegisterWidth,
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
    this.state.cycles += 2;

    return this.completeRegisterInstruction(
      context,
      "a",
      before,
      result,
      statusBefore,
      2,
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

    updateNegativeZeroFlags(this.state, maskToWidth(regValue - operand, width), width);
    setStatusFlag(this.state, StatusFlag.Carry, regValue >= operand);
    this.state.cycles += 2;

    // Register is unchanged; only status may change
    return this.completeRegisterInstruction(
      context,
      register,
      this.state[register],
      this.state[register],
      statusBefore,
      2,
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
}

export function createCpu(options: CpuOptions): W65C832Cpu {
  return new W65C832Cpu(options);
}
