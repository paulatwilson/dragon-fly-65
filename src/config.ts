export const DF65_1998_CLOCK_HZ = 40_000_000;
export const DEFAULT_HTTP_PORT = 3000;

export interface DragonFlyConfig {
  cpu: {
    clockHz: number;
  };
  server: {
    port: number;
  };
}

export interface ConfigEnv {
  DF65_CPU_CLOCK_HZ?: string | undefined;
  PORT?: string | undefined;
  [key: string]: string | undefined;
}

export function loadDragonFlyConfig(env: ConfigEnv = {}): DragonFlyConfig {
  return {
    cpu: {
      clockHz: readInteger(env.DF65_CPU_CLOCK_HZ, DF65_1998_CLOCK_HZ),
    },
    server: {
      port: readInteger(env.PORT, DEFAULT_HTTP_PORT),
    },
  };
}

function readInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new RangeError(`Expected integer config value, received "${value}"`);
  }

  return parsed;
}
