export const ADDRESS_BITS = 24;
export const ADDRESS_MASK = 0x00ff_ffff;
export const BYTE_MASK = 0xff;
export const WORD_MASK = 0xffff;
export const LONG_MASK = 0xffff_ffff;

export const WDC_MIN_CLOCK_HZ = 4_000_000;
export const WDC_MAX_CLOCK_HZ = 10_000_000;
export const RESET_VECTOR_ADDRESS = 0x00ff_fc;

// Interrupt vectors — W65C816/W65C832 compatible, all in bank 0.
// Native mode (E16=false):
export const NATIVE_COP_VECTOR   = 0x00ff_e4;
export const NATIVE_BRK_VECTOR   = 0x00ff_e6;
export const NATIVE_ABORT_VECTOR = 0x00ff_e8;
export const NATIVE_NMI_VECTOR   = 0x00ff_ea;
export const NATIVE_IRQ_VECTOR   = 0x00ff_ee;
// Emulation mode (E16=true):
export const EMU_COP_VECTOR      = 0x00ff_f4;
export const EMU_ABORT_VECTOR    = 0x00ff_f8;
export const EMU_NMI_VECTOR      = 0x00ff_fa;
export const EMU_IRQ_BRK_VECTOR  = 0x00ff_fe;

export enum StatusFlag {
  Carry = 0x01,
  Zero = 0x02,
  InterruptDisable = 0x04,
  Decimal = 0x08,
  Index = 0x10,
  Memory = 0x20,
  Overflow = 0x40,
  Negative = 0x80,
}

export type RegisterWidth = 8 | 16 | 32;

export const W65C02_RESET_STATUS =
  StatusFlag.Memory | StatusFlag.Index | StatusFlag.InterruptDisable;
