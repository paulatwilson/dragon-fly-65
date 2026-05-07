import { createClockConfig, type ClockConfig } from "./clock";
import {
  BYTE_MASK,
  RESET_VECTOR_ADDRESS,
  StatusFlag,
  WORD_MASK,
} from "./constants";
import { makeProgramAddress, readWord } from "./memory";
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
    register: "a" | "x" | "y",
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
}

export function createCpu(options: CpuOptions): W65C832Cpu {
  return new W65C832Cpu(options);
}
