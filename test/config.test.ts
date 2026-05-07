import { expect, test } from "bun:test";
import {
  DEFAULT_HTTP_PORT,
  DF65_1998_CLOCK_HZ,
  loadDragonFlyConfig,
} from "../src/config";

test("NeedleOS config defaults to the fictional 1998 40 MHz CPU", () => {
  const config = loadDragonFlyConfig();

  expect(config.cpu.clockHz).toBe(DF65_1998_CLOCK_HZ);
  expect(config.server.port).toBe(DEFAULT_HTTP_PORT);
});

test("NeedleOS config accepts external environment overrides", () => {
  const config = loadDragonFlyConfig({
    DF65_CPU_CLOCK_HZ: "8000000",
    PORT: "4242",
  });

  expect(config.cpu.clockHz).toBe(8_000_000);
  expect(config.server.port).toBe(4242);
});
