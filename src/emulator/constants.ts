export const ADDRESS_BITS = 24;
export const ADDRESS_MASK = 0x00ff_ffff;
export const BYTE_MASK = 0xff;
export const WORD_MASK = 0xffff;
export const LONG_MASK = 0xffff_ffff;

export const WDC_MIN_CLOCK_HZ = 4_000_000;
export const WDC_MAX_CLOCK_HZ = 10_000_000;
export const DF65_DEFAULT_CLOCK_HZ = 40_000_000;

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
