import { createClockConfig, type ClockConfig } from "./clock";
import {
  BYTE_MASK,
  RESET_VECTOR_ADDRESS,
  StatusFlag,
  WORD_MASK,
} from "./constants";
import { makeProgramAddress, readWord } from "./memory";
import { createInitialCpuState, setStatusFlag } from "./state";
import type { CpuOptions, CpuState, RegisterName, StepResult } from "./types";

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

  step(): StepResult {
    if (this.state.stopped) {
      return {
        pcBefore: makeProgramAddress(this.state.prb, this.state.pc),
        opcode: 0,
        cycles: 0,
        stopped: true,
      };
    }

    const pcBefore = makeProgramAddress(this.state.prb, this.state.pc);
    const opcode = this.memory.readByte(pcBefore);
    this.state.pc = (this.state.pc + 1) & WORD_MASK;

    switch (opcode) {
      case 0x18:
        return this.completeFlagInstruction(
          pcBefore,
          opcode,
          StatusFlag.Carry,
          false,
        );
      case 0x38:
        return this.completeFlagInstruction(
          pcBefore,
          opcode,
          StatusFlag.Carry,
          true,
        );
      case 0x58:
        return this.completeFlagInstruction(
          pcBefore,
          opcode,
          StatusFlag.InterruptDisable,
          false,
        );
      case 0x78:
        return this.completeFlagInstruction(
          pcBefore,
          opcode,
          StatusFlag.InterruptDisable,
          true,
        );
      case 0xb8:
        return this.completeFlagInstruction(
          pcBefore,
          opcode,
          StatusFlag.Overflow,
          false,
        );
      case 0xd8:
        return this.completeFlagInstruction(
          pcBefore,
          opcode,
          StatusFlag.Decimal,
          false,
        );
      case 0xea:
        this.state.cycles += 2;
        return {
          pcBefore,
          opcode,
          cycles: 2,
          stopped: false,
        };
      case 0xf8:
        return this.completeFlagInstruction(
          pcBefore,
          opcode,
          StatusFlag.Decimal,
          true,
        );
      case 0xdb:
        this.state.stopped = true;
        this.state.cycles += 3;
        return {
          pcBefore,
          opcode,
          cycles: 3,
          stopped: true,
        };
      default:
        throw new UnsupportedOpcodeError(opcode);
    }
  }

  private completeFlagInstruction(
    pcBefore: number,
    opcode: number,
    flag: StatusFlag,
    enabled: boolean,
  ): StepResult {
    setStatusFlag(this.state, flag, enabled);
    this.state.cycles += 2;

    return {
      pcBefore,
      opcode,
      cycles: 2,
      stopped: false,
    };
  }
}

export function createCpu(options: CpuOptions): W65C832Cpu {
  return new W65C832Cpu(options);
}
