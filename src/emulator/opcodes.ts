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

const directIndexedX = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 2,
  cycles,
  addressingMode: "direct-indexed-x",
  byteLength: () => 2,
  execute,
});

const directIndexedY = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 2,
  cycles,
  addressingMode: "direct-indexed-y",
  byteLength: () => 2,
  execute,
});

const absoluteIndexedX = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 3,
  cycles,
  addressingMode: "absolute-indexed-x",
  byteLength: () => 3,
  execute,
});

const absoluteIndexedY = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 3,
  cycles,
  addressingMode: "absolute-indexed-y",
  byteLength: () => 3,
  execute,
});

const longAbsolute = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 4,
  cycles,
  addressingMode: "long",
  byteLength: () => 4,
  execute,
});

const indirect = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 2,
  cycles,
  addressingMode: "indirect",
  byteLength: () => 2,
  execute,
});

const stackRelative = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 2,
  cycles,
  addressingMode: "stack-relative",
  byteLength: () => 2,
  execute,
});

const byteImmediate = (
  opcode: number,
  mnemonic: string,
  cycles: number,
  execute: OpcodeDefinition["execute"],
): OpcodeDefinition => ({
  opcode,
  mnemonic,
  bytes: 2,
  cycles,
  addressingMode: "immediate",
  byteLength: () => 2,
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
    stackRelative(0x83, "STA", 4, (cpu, context) =>
      cpu.completeStoreAccumulatorStackRelative(context),
    ),
    longAbsolute(0x8f, "STA", 5, (cpu, context) =>
      cpu.completeStoreAccumulatorLong(context),
    ),
    indirect(0x92, "STA", 5, (cpu, context) =>
      cpu.completeStoreAccumulatorIndirect(context),
    ),
    absoluteIndexedY(0x99, "STA", 5, (cpu, context) =>
      cpu.completeStoreAccumulatorAbsoluteIndexedY(context),
    ),
    directIndexedX(0x95, "STA", 4, (cpu, context) =>
      cpu.completeStoreAccumulatorDirectIndexedX(context),
    ),
    absoluteIndexedX(0x9d, "STA", 5, (cpu, context) =>
      cpu.completeStoreAccumulatorAbsoluteIndexedX(context),
    ),
    stackRelative(0xa3, "LDA", 4, (cpu, context) =>
      cpu.completeLoadAccumulatorStackRelative(context),
    ),
    direct(0xa4, "LDY", 3, (cpu, context) =>
      cpu.completeLoadYDirect(context),
    ),
    direct(0xa5, "LDA", 3, (cpu, context) =>
      cpu.completeLoadAccumulatorDirect(context),
    ),
    direct(0xa6, "LDX", 3, (cpu, context) =>
      cpu.completeLoadXDirect(context),
    ),
    absolute(0xac, "LDY", 4, (cpu, context) =>
      cpu.completeLoadYAbsolute(context),
    ),
    absolute(0xad, "LDA", 4, (cpu, context) =>
      cpu.completeLoadAccumulatorAbsolute(context),
    ),
    absolute(0xae, "LDX", 4, (cpu, context) =>
      cpu.completeLoadXAbsolute(context),
    ),
    longAbsolute(0xaf, "LDA", 5, (cpu, context) =>
      cpu.completeLoadAccumulatorLong(context),
    ),
    directIndexedX(0xb5, "LDA", 4, (cpu, context) =>
      cpu.completeLoadAccumulatorDirectIndexedX(context),
    ),
    indirect(0xb2, "LDA", 5, (cpu, context) =>
      cpu.completeLoadAccumulatorIndirect(context),
    ),
    absoluteIndexedY(0xb9, "LDA", 4, (cpu, context) =>
      cpu.completeLoadAccumulatorAbsoluteIndexedY(context),
    ),
    absoluteIndexedX(0xbd, "LDA", 4, (cpu, context) =>
      cpu.completeLoadAccumulatorAbsoluteIndexedX(context),
    ),
    byteImmediate(0x00, "BRK", 7, (cpu, context) =>
      cpu.completeBrkInstruction(context),
    ),
    byteImmediate(0x02, "COP", 7, (cpu, context) =>
      cpu.completeCopInstruction(context),
    ),
    implied(0x40, "RTI", 6, (cpu, context) =>
      cpu.completeReturnFromInterrupt(context),
    ),
    byteImmediate(0xc2, "REP", 3, (cpu, context) =>
      cpu.completeResetProcessorStatus(context),
    ),
    byteImmediate(0xe2, "SEP", 3, (cpu, context) =>
      cpu.completeSetProcessorStatus(context),
    ),
    implied(0xeb, "XFE", 2, (cpu, context) =>
      cpu.completeExchangeFullEmulation(context),
    ),
    implied(0xfb, "XCE", 2, (cpu, context) =>
      cpu.completeExchangeCarryEmulation(context),
    ),
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
