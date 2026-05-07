import { DF65_DEFAULT_CLOCK_HZ, WDC_MIN_CLOCK_HZ } from "./constants";

export interface ClockConfig {
  hz: number;
  mhz: number;
  nanosecondsPerCycle: number;
}

export function createClockConfig(clockHz = DF65_DEFAULT_CLOCK_HZ): ClockConfig {
  if (!Number.isInteger(clockHz) || clockHz < WDC_MIN_CLOCK_HZ) {
    throw new RangeError("CPU clock must be an integer frequency of at least 4 MHz");
  }

  return {
    hz: clockHz,
    mhz: clockHz / 1_000_000,
    nanosecondsPerCycle: 1_000_000_000 / clockHz,
  };
}

