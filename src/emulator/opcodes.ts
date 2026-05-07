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

const relative = (
  opcode: number,
  mnemonic: string,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 2,
  cycles: 2,
  addressingMode: "relative",
  byteLength: () => 2,
  execute,
});

export const OPCODES = new Map<number, OpcodeDefinition>(
  [
    accumulatorImmediate(0x09, "ORA", 2, (cpu, context) =>
      cpu.completeOrImmediate(context),
    ),
    accumulatorImmediate(0x29, "AND", 2, (cpu, context) =>
      cpu.completeAndImmediate(context),
    ),
    accumulatorImmediate(0x49, "EOR", 2, (cpu, context) =>
      cpu.completeExclusiveOrImmediate(context),
    ),
    accumulatorImmediate(0x69, "ADC", 2, (cpu, context) =>
      cpu.completeAddWithCarryImmediate(context),
    ),
    indexImmediate(0xc0, "CPY", 2, (cpu, context) =>
      cpu.completeCompareYImmediate(context),
    ),
    accumulatorImmediate(0xc9, "CMP", 2, (cpu, context) =>
      cpu.completeCompareAccumulatorImmediate(context),
    ),
    indexImmediate(0xe0, "CPX", 2, (cpu, context) =>
      cpu.completeCompareXImmediate(context),
    ),
    accumulatorImmediate(0xe9, "SBC", 2, (cpu, context) =>
      cpu.completeSubtractWithCarryImmediate(context),
    ),
    absolute(0x20, "JSR", 6, (cpu, context) =>
      cpu.completeJumpToSubroutine(context),
    ),
    implied(0x60, "RTS", 6, (cpu, context) =>
      cpu.completeReturnFromSubroutine(context),
    ),
    relative(0x10, "BPL", (cpu, context) =>
      cpu.completeBranch(context, StatusFlag.Negative, false),
    ),
    relative(0x30, "BMI", (cpu, context) =>
      cpu.completeBranch(context, StatusFlag.Negative, true),
    ),
    relative(0x50, "BVC", (cpu, context) =>
      cpu.completeBranch(context, StatusFlag.Overflow, false),
    ),
    relative(0x70, "BVS", (cpu, context) =>
      cpu.completeBranch(context, StatusFlag.Overflow, true),
    ),
    relative(0x90, "BCC", (cpu, context) =>
      cpu.completeBranch(context, StatusFlag.Carry, false),
    ),
    relative(0xb0, "BCS", (cpu, context) =>
      cpu.completeBranch(context, StatusFlag.Carry, true),
    ),
    relative(0xd0, "BNE", (cpu, context) =>
      cpu.completeBranch(context, StatusFlag.Zero, false),
    ),
    relative(0xf0, "BEQ", (cpu, context) =>
      cpu.completeBranch(context, StatusFlag.Zero, true),
    ),
    absolute(0x4c, "JMP", 3, (cpu, context) =>
      cpu.completeJumpAbsolute(context),
    ),
    accumulatorImmediate(0xa9, "LDA", 2, (cpu, context) =>
      cpu.completeLoadAccumulatorImmediate(context),
    ),
    indexImmediate(0xa0, "LDY", 2, (cpu, context) =>
      cpu.completeLoadYImmediate(context),
    ),
    indexImmediate(0xa2, "LDX", 2, (cpu, context) =>
      cpu.completeLoadXImmediate(context),
    ),
    implied(0x08, "PHP", 3, (cpu, context) =>
      cpu.completePushProcessorStatus(context),
    ),
    implied(0x28, "PLP", 4, (cpu, context) =>
      cpu.completePullProcessorStatus(context),
    ),
    implied(0x48, "PHA", 3, (cpu, context) =>
      cpu.completePushAccumulator(context),
    ),
    implied(0x68, "PLA", 4, (cpu, context) =>
      cpu.completePullAccumulator(context),
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
    implied(0x88, "DEY", 2, (cpu, context) =>
      cpu.completeDecrementY(context),
    ),
    implied(0x8a, "TXA", 2, (cpu, context) =>
      cpu.completeTransferXToAccumulator(context),
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
    implied(0x98, "TYA", 2, (cpu, context) =>
      cpu.completeTransferYToAccumulator(context),
    ),
    implied(0x9a, "TXS", 2, (cpu, context) =>
      cpu.completeTransferXToStack(context),
    ),
    implied(0xa8, "TAY", 2, (cpu, context) =>
      cpu.completeTransferAccumulatorToY(context),
    ),
    implied(0xaa, "TAX", 2, (cpu, context) =>
      cpu.completeTransferAccumulatorToX(context),
    ),
    implied(0xba, "TSX", 2, (cpu, context) =>
      cpu.completeTransferStackToX(context),
    ),
    implied(0xc8, "INY", 2, (cpu, context) =>
      cpu.completeIncrementY(context),
    ),
    implied(0xca, "DEX", 2, (cpu, context) =>
      cpu.completeDecrementX(context),
    ),
    implied(0xe8, "INX", 2, (cpu, context) =>
      cpu.completeIncrementX(context),
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
