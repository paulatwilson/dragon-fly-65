import { BYTE_MASK, WORD_MASK } from "./constants";
import { makeProgramAddress } from "./memory";
import { createInitialCpuState } from "./state";
import type { CpuOptions, CpuState, RegisterName, StepResult } from "./types";

export class UnsupportedOpcodeError extends Error {
  constructor(opcode: number) {
    super(`Unsupported W65C832 opcode: 0x${opcode.toString(16).padStart(2, "0")}`);
    this.name = "UnsupportedOpcodeError";
  }
}

export class W65C832Cpu {
  readonly memory: CpuOptions["memory"];
  readonly state: CpuState;

  constructor(options: CpuOptions) {
    this.memory = options.memory;
    this.state = createInitialCpuState();
  }

  reset(): void {
    const fresh = createInitialCpuState();
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
      case 0xea:
        this.state.cycles += 2;
        return {
          pcBefore,
          opcode,
          cycles: 2,
          stopped: false,
        };
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
}

export function createCpu(options: CpuOptions): W65C832Cpu {
  return new W65C832Cpu(options);
}
