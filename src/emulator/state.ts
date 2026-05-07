import {
  BYTE_MASK,
  LONG_MASK,
  StatusFlag,
  WORD_MASK,
  W65C02_RESET_STATUS,
  type RegisterWidth,
} from "./constants";
import type { CpuState, WidthMode } from "./types";

export function createInitialCpuState(): CpuState {
  return {
    a: 0,
    x: 0,
    y: 0,
    sp: 0x01ff,
    pc: 0,
    dr: 0,
    drb: 0,
    prb: 0,
    p: W65C02_RESET_STATUS,
    e8: true,
    e16: true,
    stopped: false,
    cycles: 0,
  };
}

export function hasStatusFlag(state: CpuState, flag: StatusFlag): boolean {
  return (state.p & flag) !== 0;
}

export function setStatusFlag(
  state: CpuState,
  flag: StatusFlag,
  enabled: boolean,
): void {
  state.p = enabled ? state.p | flag : state.p & ~flag;
  state.p &= BYTE_MASK;
}

export function resolveWidthMode(state: CpuState): WidthMode {
  const m = hasStatusFlag(state, StatusFlag.Memory);
  const x = hasStatusFlag(state, StatusFlag.Index);

  if (state.e16 && state.e8) {
    return {
      accumulator: 8,
      index: 8,
      mode: "w65c02-emulation",
    };
  }

  if (state.e16 && !state.e8) {
    return {
      accumulator: m ? 8 : 16,
      index: x ? 8 : 16,
      mode: "w65c816-emulation",
    };
  }

  if (!state.e16 && state.e8) {
    return {
      accumulator: m ? 8 : 32,
      index: x ? 8 : 32,
      mode: "w65c832-native",
    };
  }

  return {
    accumulator: m ? 8 : 16,
    index: x ? 8 : 32,
    mode: "w65c832-native",
  };
}

export function maskForWidth(width: RegisterWidth): number {
  switch (width) {
    case 8:
      return BYTE_MASK;
    case 16:
      return WORD_MASK;
    case 32:
      return LONG_MASK;
  }
}

export function maskToWidth(value: number, width: RegisterWidth): number {
  return (value & maskForWidth(width)) >>> 0;
}

export function updateNegativeZeroFlags(
  state: CpuState,
  value: number,
  width: RegisterWidth,
): void {
  const masked = maskToWidth(value, width);
  const negativeBit = width === 32 ? 0x8000_0000 : 1 << (width - 1);

  setStatusFlag(state, StatusFlag.Zero, masked === 0);
  setStatusFlag(state, StatusFlag.Negative, (masked & negativeBit) !== 0);
}
