import { StatusFlag } from "./constants";
import type { W65C832Cpu } from "./cpu";
import type { AddressingMode, StepResult } from "./types";

export interface InstructionContext {
  pcBefore: number;
  opcode: number;
  bytes: number[];
}

export interface OpcodeDefinition {
  opcode: number;
  mnemonic: string;
  bytes: number;
  cycles: number;
  addressingMode: AddressingMode;
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
  execute,
});

export const OPCODES = new Map<number, OpcodeDefinition>(
  [
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

