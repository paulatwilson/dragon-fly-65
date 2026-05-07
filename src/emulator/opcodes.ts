import { StatusFlag } from "./constants";
import type { W65C832Cpu } from "./cpu";
import type { AddressingMode, StepResult } from "./types";

export interface InstructionContext {
  pcBefore: number;
  opcode: number;
  bytes: number[];
  operandBytes: number[];
}

export interface OpcodeDefinition {
  opcode: number;
  mnemonic: string;
  bytes: number;
  cycles: number;
  addressingMode: AddressingMode;
  byteLength(cpu: W65C832Cpu): number;
  execute(cpu: W65C832Cpu, context: InstructionContext): StepResult;
}

const implied = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 1,
  cycles,
  addressingMode: "implied",
  byteLength: () => 1,
  execute,
});

const accumulatorImmediate = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 0,
  cycles,
  addressingMode: "immediate",
  byteLength: (cpu) => {
    const { accumulator } = cpu.getWidthMode();
    return accumulator / 8 + 1;
  },
  execute,
});

const indexImmediate = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 0,
  cycles,
  addressingMode: "immediate",
  byteLength: (cpu) => {
    const { index } = cpu.getWidthMode();
    return index / 8 + 1;
  },
  execute,
});

const direct = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 2,
  cycles,
  addressingMode: "direct",
  byteLength: () => 2,
  execute,
});

const absolute = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 3,
  cycles,
  addressingMode: "absolute",
  byteLength: () => 3,
  execute,
});

export const OPCODES = new Map<number, OpcodeDefinition>(
  [
    accumulatorImmediate(0xa9, "LDA", 2, (cpu, context) =>
      cpu.completeLoadAccumulatorImmediate(context),
    ),
    indexImmediate(0xa0, "LDY", 2, (cpu, context) =>
      cpu.completeLoadYImmediate(context),
    ),
    indexImmediate(0xa2, "LDX", 2, (cpu, context) =>
      cpu.completeLoadXImmediate(context),
    ),
    direct(0x84, "STY", 3, (cpu, context) =>
      cpu.completeStoreYDirect(context),
    ),
    direct(0x85, "STA", 3, (cpu, context) =>
      cpu.completeStoreAccumulatorDirect(context),
    ),
    direct(0x86, "STX", 3, (cpu, context) =>
      cpu.completeStoreXDirect(context),
    ),
    absolute(0x8c, "STY", 4, (cpu, context) =>
      cpu.completeStoreYAbsolute(context),
    ),
    absolute(0x8d, "STA", 4, (cpu, context) =>
      cpu.completeStoreAccumulatorAbsolute(context),
    ),
    absolute(0x8e, "STX", 4, (cpu, context) =>
      cpu.completeStoreXAbsolute(context),
    ),
    implied(0x18, "CLC", 2, (cpu, context) =>
      cpu.completeFlagInstruction(context, StatusFlag.Carry, false),
    ),
    implied(0x38, "SEC", 2, (cpu, context) =>
      cpu.completeFlagInstruction(context, StatusFlag.Carry, true),
    ),
    implied(0x58, "CLI", 2, (cpu, context) =>
      cpu.completeFlagInstruction(context, StatusFlag.InterruptDisable, false),
    ),
    implied(0x78, "SEI", 2, (cpu, context) =>
      cpu.completeFlagInstruction(context, StatusFlag.InterruptDisable, true),
    ),
    implied(0xb8, "CLV", 2, (cpu, context) =>
      cpu.completeFlagInstruction(context, StatusFlag.Overflow, false),
    ),
    implied(0xd8, "CLD", 2, (cpu, context) =>
      cpu.completeFlagInstruction(context, StatusFlag.Decimal, false),
    ),
    implied(0xdb, "STP", 3, (cpu, context) =>
      cpu.completeStopInstruction(context),
    ),
    implied(0xea, "NOP", 2, (cpu, context) =>
      cpu.completeNoopInstruction(context),
    ),
    implied(0xf8, "SED", 2, (cpu, context) =>
      cpu.completeFlagInstruction(context, StatusFlag.Decimal, true),
    ),
  ].map((definition) => [definition.opcode, definition]),
);

export function getOpcodeDefinition(
  opcode: number,
): OpcodeDefinition | undefined {
  return OPCODES.get(opcode);
}
