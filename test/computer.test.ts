import { describe, expect, test } from "bun:test";
import { bootMonitorComputer } from "../src/computer/boot";
import type { Machine } from "../src/machine";

function runWithInput(machine: Machine, input: string, maxSteps = 1_000_000): string {
  const bytes = [...input].map(char => char.charCodeAt(0));
  let byteIndex = 0;
  let inputFed = false;
  let steps = 0;
  let lastOutputStep = 0;
  const captured: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured.push(typeof chunk === "string" ? chunk : String.fromCharCode(...chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    while (steps < maxSteps) {
      if (!inputFed && byteIndex < bytes.length && steps % 200 === 0) {
        machine.pushInput(bytes[byteIndex++]!);
        inputFed = byteIndex >= bytes.length;
      }

      if (machine.step()) break;
      steps++;

      if (captured.length > 0) {
        lastOutputStep = steps;
      }

      if (inputFed && steps - lastOutputStep > 50_000) {
        break;
      }
    }
  } finally {
    process.stdout.write = originalWrite;
  }

  return captured.join("");
}

describe("DragonFly computer", () => {
  test("boots into the monitor", () => {
    const { machine, monitorOrigin } = bootMonitorComputer();
    const output = runWithInput(machine, "H\r");

    expect(monitorOrigin).toBe(0xe000);
    expect(output).toContain("DragonFly 65 Monitor");
    expect(output).toContain("GAAAA");
  });

  test("protects monitor ROM from machine writes", () => {
    const { machine } = bootMonitorComputer();
    const originalRomByte = machine.mem.readByte(0xe000);

    machine.mem.writeByte(0xe000, originalRomByte ^ 0xff);
    machine.mem.writeByte(0x0300, 0x42);

    expect(machine.mem.readByte(0xe000)).toBe(originalRomByte);
    expect(machine.mem.readByte(0x0300)).toBe(0x42);
  });

  test("does not load program bytes into monitor ROM", () => {
    const { machine } = bootMonitorComputer();

    expect(() => machine.load(new Uint8Array([0xea]), 0xe000)).toThrow(RangeError);
  });
});
